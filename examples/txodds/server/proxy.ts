import http from 'node:http'
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import bs58 from 'bs58'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { complete, parseJsonReply } from '../../../packages/agent-runtime/src/llm/complete.ts'
import { deposit as escrowDeposit, escrowPda, makeProgram, release as escrowRelease, refund as escrowRefund } from '../agent/escrow.ts'

const ENV_PATH = process.env.KIT_ENV ?? fileURLToPath(new URL('../../../.env', import.meta.url))
const DATA_DIR = fileURLToPath(new URL('../.data/', import.meta.url))
const DATA_FILE = `${DATA_DIR}jobs.json`
const AGENTS_FILE = `${DATA_DIR}agents.json`
const REVIEW_DIR = `${DATA_DIR}reviews`
const PORT = Number(process.env.PORT ?? 8801)
const ROOT_DIR = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const DEFAULT_RPC_URL = 'https://api.devnet.solana.com'
const BALANCE_TIMEOUT_MS = 2500
const REVIEW_TIMEOUT_MS = Number(process.env.REVIEW_TIMEOUT_MS ?? 90000)
const AUTO_RELEASE_MS = Number(process.env.AUTO_RELEASE_MS ?? 72 * 60 * 60 * 1000)
const ESCROW_DEADLINE_SECS = Number(process.env.ESCROW_DEADLINE_SECS ?? 72 * 60 * 60)
const BID_WINDOW_MS = Number(process.env.BID_WINDOW_MS ?? 30_000)
const MAX_LOG_CHARS = 6000
const MAX_SNIPPET_CHARS = 2000

type Actor = 'employer' | 'worker' | 'agent' | 'system'
type Status = 'open' | 'funded' | 'submitted' | 'approved' | 'released' | 'revision_requested' | 'disputed' | 'refunded' | 'cancelled'
type MilestoneStatus = 'pending' | 'complete'
type SettlementEventType = 'funded' | 'submitted' | 'reviewed' | 'released' | 'disputed' | 'refunded' | 'cancelled'
type ReviewSource = 'ai' | 'legacy-heuristic' | 'fallback'
type ReviewRecommendation = 'approve' | 'revision' | 'dispute'
type ReviewCheckStatus = 'pass' | 'fail' | 'unclear'
type ArtifactStatus = 'pass' | 'fail' | 'skipped'
type ArtifactKind = 'screenshot' | 'log' | 'text'

interface Event { at: string; actor: Actor; type: string; summary: string }
interface Message { at: string; author: Exclude<Actor, 'system'>; text: string }
interface Submission { at: string; url: string; repo: string; notes: string }
interface ReviewCheck { label: string; status: ReviewCheckStatus; reason: string; evidence: string }
interface ReviewArtifact { id: string; kind: ArtifactKind; label: string; file: string; mime: string }
interface ArtifactResult { status: ArtifactStatus; summary: string; error?: string; log?: string }
interface RepoArtifact extends ArtifactResult {
  url?: string
  commit?: string
  packageManager?: string
  scripts?: Record<string, string>
  files?: Array<{ path: string; snippet: string }>
}
interface BuildArtifact extends ArtifactResult { command?: string; outputDir?: string }
interface PreviewArtifact extends ArtifactResult { url?: string; httpStatus?: number; title?: string }
interface ArtifactRun {
  id: string
  at: string
  repo: RepoArtifact
  build: BuildArtifact
  preview: PreviewArtifact
  screenshots: ReviewArtifact[]
  logs: ReviewArtifact[]
}
interface Review {
  at: string
  approved: boolean
  score: number
  summary: string
  missing: string[]
  source: ReviewSource
  recommendation: ReviewRecommendation
  checks: ReviewCheck[]
  risks: string[]
  criteriaResults: ReviewCheck[]
  artifactRun?: ArtifactRun
  confidence: number
  criticalRisks: string[]
  releaseEligible: boolean
  revisionInstructions: string
  autoReleaseAt?: string
}
interface Milestone { id: string; title: string; description: string; amountSol: number; status: MilestoneStatus; completedAt?: string }
interface Dispute {
  at: string
  by: Exclude<Actor, 'system' | 'agent'>
  note: string
  status: 'open' | 'resolved'
  outcome?: 'release' | 'revision' | 'manual'
  reviewedAt?: string
  summary?: string
}
interface SettlementEvent { at: string; type: SettlementEventType; summary: string }
interface MarketplaceBid { at: string; round: number; by: string; wallet: string; priceSol: number; note?: string }
interface MarketplaceState {
  round: number
  status: 'open' | 'awarded' | 'delivered' | 'settled' | 'refunded'
  budgetSol: number
  bids: MarketplaceBid[]
  awardedBid?: MarketplaceBid
  bidWindowEndsAt?: string
  awardError?: string
  threadId?: string
}
interface ConnectedAgent {
  id: string
  name: string
  wallet?: string
  tokenHash: string
  status: 'active' | 'revoked'
  createdAt: string
  lastSeenAt?: string
}
type AgentAuth = { kind: 'platform' } | { kind: 'agent'; agent: ConnectedAgent }
interface DevnetEscrow {
  buyer: string
  seller: string
  reference: string
  escrow: string
  amountSol: number
  deadlineAt: string
  deposit?: string
  release?: string
  refund?: string
}
interface Settlement {
  mode: 'local-demo' | 'devnet-escrow'
  escrow: string
  release?: string
  refund?: string
  devnet?: DevnetEscrow
  events: SettlementEvent[]
}
export interface Job {
  id: string
  status: Status
  createdAt: string
  title: string
  employer: string
  worker: string
  scope: string
  requirements: string
  acceptanceCriteria: string
  amountSol: number
  milestones: Milestone[]
  reference: string
  messages: Message[]
  submission?: Submission
  review?: Review
  disputes: Dispute[]
  marketplace?: MarketplaceState
  settlement: Settlement
  events: Event[]
}

export interface DemoRunStatus {
  running: boolean
  agentName: string
  pid?: number
  jobId?: string
  previewUrl?: string
  startedAt?: string
  error?: string
  logs: string[]
  steps: {
    agentStarted: boolean
    jobPosted: boolean
    bidPlaced: boolean
    awarded: boolean
    funded: boolean
    buildServed: boolean
    deliverySubmitted: boolean
    reviewCaptured: boolean
  }
}

interface DemoRunner {
  start(input?: Record<string, unknown>): Promise<DemoRunStatus>
  status(): Promise<DemoRunStatus>
}

const terminal = new Set<Status>(['released', 'refunded', 'cancelled'])
const statuses = new Set<Status>(['open', 'funded', 'submitted', 'approved', 'released', 'revision_requested', 'disputed', 'refunded', 'cancelled'])

async function loadEnv() {
  try {
    for (const line of (await fs.readFile(ENV_PATH, 'utf8')).split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    // No secrets by default. Run node scripts/setup.js to create local devnet keys.
  }
}

const jobs = new Map<string, Job>()
const connectedAgents = new Map<string, ConnectedAgent>()
const demoAgentBase = 'demo-worker-live'
const demoRunState: {
  child?: ReturnType<typeof spawn>
  agentName?: string
  token?: string
  jobId?: string
  previewUrl?: string
  startedAt?: string
  error?: string
  logs: string[]
} = { logs: [] }

function demoSteps(job?: Job): DemoRunStatus['steps'] {
  const market = job?.marketplace
  return {
    agentStarted: Boolean(demoRunState.child && demoRunState.child.exitCode === null && !demoRunState.child.killed),
    jobPosted: Boolean(job),
    bidPlaced: Boolean(market?.bids?.length),
    awarded: Boolean(market?.awardedBid),
    funded: job?.settlement.mode === 'devnet-escrow',
    buildServed: Boolean(demoRunState.previewUrl || job?.submission?.url),
    deliverySubmitted: Boolean(job?.submission),
    reviewCaptured: Boolean(job?.review),
  }
}

function cleanDemoText(value: unknown): string {
  return String(value ?? '')
    .replace(/agt_[A-Za-z0-9_-]+/g, 'agt_[redacted]')
    .replace(/AGENT_API_TOKEN=\S+/g, 'AGENT_API_TOKEN=[redacted]')
}

function appendDemoLog(value: unknown): void {
  for (const line of cleanDemoText(value).split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const preview = line.match(/serving generated delivery at\s+(https?:\/\/\S+)/i)?.[1]
    if (preview) demoRunState.previewUrl = preview
    demoRunState.logs.push(line)
  }
  demoRunState.logs = demoRunState.logs.slice(-40)
}

function demoJob(): Job | undefined {
  return demoRunState.jobId ? jobs.get(demoRunState.jobId) : undefined
}

function demoStatus(): DemoRunStatus {
  const job = demoJob()
  const running = Boolean(demoRunState.child && demoRunState.child.exitCode === null && !demoRunState.child.killed)
  const previewUrl = job?.submission?.url || demoRunState.previewUrl
  const error = demoRunState.error || job?.marketplace?.awardError
  return {
    running,
    agentName: demoRunState.agentName || demoAgentBase,
    ...(running && demoRunState.child?.pid ? { pid: demoRunState.child.pid } : {}),
    ...(demoRunState.jobId ? { jobId: demoRunState.jobId } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(demoRunState.startedAt ? { startedAt: demoRunState.startedAt } : {}),
    ...(error ? { error: cleanDemoText(error) } : {}),
    logs: demoRunState.logs.map(cleanDemoText),
    steps: demoSteps(job),
  }
}

function sanitizeDemoStatus(input: DemoRunStatus | Record<string, unknown>): DemoRunStatus {
  const source = input as Partial<DemoRunStatus>
  const steps = source.steps || {} as DemoRunStatus['steps']
  return {
    running: Boolean(source.running),
    agentName: String(source.agentName || demoAgentBase),
    ...(Number.isFinite(Number(source.pid)) ? { pid: Number(source.pid) } : {}),
    ...(source.jobId ? { jobId: String(source.jobId) } : {}),
    ...(source.previewUrl ? { previewUrl: String(source.previewUrl) } : {}),
    ...(source.startedAt ? { startedAt: String(source.startedAt) } : {}),
    ...(source.error ? { error: cleanDemoText(source.error) } : {}),
    logs: Array.isArray(source.logs) ? source.logs.map(cleanDemoText).slice(-40) : [],
    steps: {
      agentStarted: Boolean(steps.agentStarted),
      jobPosted: Boolean(steps.jobPosted),
      bidPlaced: Boolean(steps.bidPlaced),
      awarded: Boolean(steps.awarded),
      funded: Boolean(steps.funded),
      buildServed: Boolean(steps.buildServed),
      deliverySubmitted: Boolean(steps.deliverySubmitted),
      reviewCaptured: Boolean(steps.reviewCaptured),
    },
  }
}

function resetDemoRun(): void {
  if (demoRunState.child && demoRunState.child.exitCode === null && !demoRunState.child.killed) {
    demoRunState.child.kill()
  }
  demoRunState.child = undefined
  demoRunState.agentName = undefined
  demoRunState.token = undefined
  demoRunState.jobId = undefined
  demoRunState.previewUrl = undefined
  demoRunState.startedAt = undefined
  demoRunState.error = undefined
  demoRunState.logs = []
}

function demoAgentName(): string {
  if (![...connectedAgents.values()].some((agent) => agent.status === 'active' && agent.name === demoAgentBase)) {
    return demoAgentBase
  }
  return `${demoAgentBase}-${Date.now().toString(36)}`
}

function createDemoRunJob(): Job {
  const job = createJob({
    title: 'Build a live agent checkout page',
    employer: 'Northstar Studio',
    marketplace: true,
    scope: 'Generate and serve a responsive checkout mini-site with pricing copy, mobile proof, and delivery notes.',
    acceptanceCriteria: 'Includes a clickable preview URL; generated checkout hero; pricing proof; mobile responsive layout; delivery notes for every acceptance item.',
    amountSol: 0.003,
    milestones: [
      'Generate checkout mini-site',
      'Serve local preview',
      'Submit preview URL and delivery notes',
    ],
  })
  if (job.marketplace) {
    const fastBidWindow = Number(process.env.DEMO_RUN_BID_WINDOW_MS ?? 3000)
    job.marketplace.bidWindowEndsAt = new Date(Date.now() + (Number.isFinite(fastBidWindow) ? fastBidWindow : 3000)).toISOString()
  }
  job.messages.push({ at: now(), author: 'employer', text: 'Demo run: worker agent should generate and submit a clickable preview.' })
  addEvent(job, 'system', 'demo_run', 'One-click live agent demo started')
  return job
}

async function startLocalDemoRun(input: Record<string, unknown> = {}): Promise<DemoRunStatus> {
  const restart = Boolean(input.restart)
  const running = Boolean(demoRunState.child && demoRunState.child.exitCode === null && !demoRunState.child.killed)
  if (running && !restart) return demoStatus()
  if (running && restart) resetDemoRun()

  const workerWallet = wallets().worker
  if (!publicKey(workerWallet)) fail('SELLER_KEYPAIR_B58 or WALLET is required before running the live agent demo', 503)

  const created = createConnectedAgent({ name: demoAgentName(), wallet: workerWallet })
  const job = createDemoRunJob()
  await saveAgents()
  await saveJobs()

  demoRunState.agentName = created.agent.name
  demoRunState.token = created.token
  demoRunState.jobId = job.id
  demoRunState.previewUrl = undefined
  demoRunState.startedAt = now()
  demoRunState.error = undefined
  demoRunState.logs = []

  const env = {
    ...process.env,
    AGENT_TRANSPORT: 'api',
    AGENT_API_BASE: `http://localhost:${PORT}`,
    AGENT_API_TOKEN: created.token,
    AGENT_NAME: created.agent.name,
    DEMO_WORKER_WALLET: workerWallet,
    DEMO_GENERATE_DELIVERY: '1',
    DEMO_DELIVERY_URL: '',
    DEMO_DELIVERY_REPO: '',
    DEMO_DELIVERY_PORT: String(process.env.DEMO_RUN_DELIVERY_PORT ?? 0),
    DEMO_DELIVERY_DELAY_MS: String(process.env.DEMO_RUN_DELIVERY_DELAY_MS ?? 300),
    DEMO_AGENT_POLL_MS: String(process.env.DEMO_RUN_POLL_MS ?? 750),
    DEMO_BID_PRICE_SOL: String(process.env.DEMO_RUN_BID_PRICE_SOL ?? 0.001),
  }
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(npmCommand(), ['--prefix', 'agents/demo-worker', 'run', 'dev'], {
      cwd: ROOT_DIR,
      env,
      windowsHide: true,
      shell: process.platform === 'win32',
    })
  } catch (e) {
    const message = (e as Error).message
    demoRunState.error = message
    appendDemoLog(`[demo-run] worker error: ${message}`)
    return demoStatus()
  }
  demoRunState.child = child
  appendDemoLog(`[demo-run] started ${created.agent.name} for ${job.id}`)
  child.stdout?.on('data', appendDemoLog)
  child.stderr?.on('data', appendDemoLog)
  child.on('error', (error) => {
    demoRunState.error = error.message
    appendDemoLog(`[demo-run] worker error: ${error.message}`)
  })
  child.on('exit', (code) => {
    if (code && !demoRunState.error) demoRunState.error = `worker exited with code ${code}`
    appendDemoLog(`[demo-run] worker exited with code ${code ?? 'unknown'}`)
  })
  return demoStatus()
}

const localDemoRunner: DemoRunner = {
  start: startLocalDemoRun,
  async status() {
    return demoStatus()
  },
}

async function loadJobs(): Promise<void> {
  try {
    const list = JSON.parse(await fs.readFile(DATA_FILE, 'utf8')) as unknown[]
    for (const job of list) {
      const hydrated = hydrateJob(job)
      if (hydrated) jobs.set(hydrated.id, hydrated)
    }
  } catch {
    // Fresh checkout: no local state yet.
  }
}

async function saveJobs(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(DATA_FILE, JSON.stringify([...jobs.values()], null, 2))
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function sanitizeAgent(agent: ConnectedAgent) {
  return {
    id: agent.id,
    name: agent.name,
    wallet: agent.wallet || '',
    status: agent.status,
    createdAt: agent.createdAt,
    lastSeenAt: agent.lastSeenAt || '',
    token: agent.status === 'active' ? 'generated' : 'revoked',
  }
}

function hydrateConnectedAgent(input: unknown): ConnectedAgent | null {
  if (!input || typeof input !== 'object') return null
  const source = input as Partial<ConnectedAgent>
  const id = String(source.id || '').trim()
  const name = String(source.name || '').trim()
  const tokenHash = String(source.tokenHash || '').trim()
  if (!id || !name || !tokenHash) return null
  return {
    id,
    name,
    ...(source.wallet ? { wallet: String(source.wallet) } : {}),
    tokenHash,
    status: source.status === 'revoked' ? 'revoked' : 'active',
    createdAt: String(source.createdAt || now()),
    ...(source.lastSeenAt ? { lastSeenAt: String(source.lastSeenAt) } : {}),
  }
}

async function loadAgents(): Promise<void> {
  try {
    const list = JSON.parse(await fs.readFile(AGENTS_FILE, 'utf8')) as unknown[]
    for (const agent of list) {
      const hydrated = hydrateConnectedAgent(agent)
      if (hydrated) connectedAgents.set(hydrated.id, hydrated)
    }
  } catch {
    // No connected agents yet.
  }
}

async function saveAgents(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(AGENTS_FILE, JSON.stringify([...connectedAgents.values()], null, 2))
}

function listConnectedAgents() {
  return [...connectedAgents.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(sanitizeAgent)
}

export function createConnectedAgent(input: Record<string, unknown>): { agent: ReturnType<typeof sanitizeAgent>; token: string } {
  const name = participantName(input.name, '').trim()
  if (!name) fail('agent name is required')
  if ([...connectedAgents.values()].some((agent) => agent.status === 'active' && agent.name === name)) {
    fail('an active agent with that name already exists', 409)
  }
  const wallet = String(input.wallet || '').trim()
  if (wallet && !publicKey(wallet)) fail('valid payout wallet is required')
  const id = `agent_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
  const token = `agt_${randomBytes(24).toString('base64url')}`
  const agent: ConnectedAgent = {
    id,
    name,
    ...(wallet ? { wallet } : {}),
    tokenHash: hashToken(token),
    status: 'active',
    createdAt: now(),
  }
  connectedAgents.set(id, agent)
  return { agent: sanitizeAgent(agent), token }
}

export function revokeConnectedAgent(id: string): ReturnType<typeof sanitizeAgent> {
  const agent = connectedAgents.get(id)
  if (!agent) fail('agent not found', 404)
  agent.status = 'revoked'
  return sanitizeAgent(agent)
}

function keypair(key: string): Keypair | null {
  const raw = process.env[key]?.trim()
  if (!raw) return null
  try { return Keypair.fromSecretKey(bs58.decode(raw)) } catch { return null }
}

function publicKey(input: unknown): PublicKey | null {
  try {
    const text = String(input || '').trim()
    return text ? new PublicKey(text) : null
  } catch {
    return null
  }
}

function wallets() {
  const employer = keypair('BUYER_KEYPAIR_B58')?.publicKey.toBase58()
  const worker = keypair('SELLER_KEYPAIR_B58')?.publicKey.toBase58() || process.env.WALLET || ''
  return { employer, worker, configured: Boolean(employer && worker) }
}

async function solBalance(connection: Connection, address?: string): Promise<number | null> {
  if (!address) return null
  try {
    const lamports = await Promise.race([
      connection.getBalance(new PublicKey(address), 'confirmed'),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), BALANCE_TIMEOUT_MS)),
    ])
    return typeof lamports === 'number' ? Number((lamports / LAMPORTS_PER_SOL).toFixed(9)) : null
  } catch {
    return null
  }
}

async function walletsWithBalances() {
  const w = wallets()
  const connection = new Connection(process.env.SOLANA_RPC_URL || DEFAULT_RPC_URL, 'confirmed')
  const [employerSol, workerSol] = await Promise.all([
    solBalance(connection, w.employer),
    solBalance(connection, w.worker),
  ])
  return { ...w, balances: { employerSol, workerSol } }
}

function referenceFor(input: string): string {
  return new PublicKey(createHash('sha256').update(input).digest()).toBase58()
}

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status })
}

function now() {
  return new Date().toISOString()
}

function deadlineFrom(at: string, ms = AUTO_RELEASE_MS) {
  return new Date(new Date(at).getTime() + ms).toISOString()
}

function deadlineFromNowSecs(secs = ESCROW_DEADLINE_SECS) {
  return new Date(Date.now() + secs * 1000).toISOString()
}

function activeDispute(job: Job): Dispute | undefined {
  return job.disputes.find((dispute) => dispute.status === 'open')
}

function addEvent(job: Job, actor: Actor, type: string, summary: string) {
  job.events.unshift({ at: now(), actor, type, summary })
}

function addSettlementEvent(job: Job, type: SettlementEventType, summary: string) {
  job.settlement.events.unshift({ at: now(), type, summary })
}

function ensureNotTerminal(job: Job, action: string) {
  if (terminal.has(job.status)) fail(`cannot ${action} a ${job.status} job`, 409)
}

function ensureStatus(job: Job, allowed: Status[], action: string) {
  ensureNotTerminal(job, action)
  if (!allowed.includes(job.status)) fail(`cannot ${action} while job is ${job.status}`, 409)
}

function participantName(input: unknown, fallback: string): string {
  const value = String(input || '').trim()
  return value || fallback
}

function makeMilestones(input: unknown, amountSol: number, scope: string, criteria: string): Milestone[] {
  const fromArray = Array.isArray(input)
    ? input
      .map((item) => typeof item === 'string' ? item : (item as { title?: unknown; description?: unknown })?.title ?? '')
      .map((item) => String(item).trim())
      .filter(Boolean)
    : []
  const fromText = typeof input === 'string'
    ? input.split(/\r?\n|;/).map((item) => item.trim()).filter(Boolean)
    : []
  const titles = (fromArray.length ? fromArray : fromText).slice(0, 8)
  const chosen = titles.length ? titles : [
    'Scope and terms accepted',
    'Delivery evidence submitted',
    'Review and settlement completed',
  ]
  const share = Number((amountSol / chosen.length).toFixed(6))
  return chosen.map((title, i) => ({
    id: `ms_${i + 1}`,
    title,
    description: i === 0 ? scope : i === chosen.length - 1 ? criteria : '',
    amountSol: i === chosen.length - 1 ? Number((amountSol - share * (chosen.length - 1)).toFixed(6)) : share,
    status: 'pending',
  }))
}

function normalizeBody(input: Record<string, unknown>) {
  const amountSol = Math.max(0.001, Number(input.amountSol) || 0.001)
  const scope = String(input.scope || input.requirements || '').trim()
  const acceptanceCriteria = String(input.acceptanceCriteria || '').trim()
  const worker = String(input.worker || '').trim()
  const employer = participantName(input.employer, wallets().employer || 'Employer')
  const openTask = !worker && (input.marketplace === true || input.workflow === 'marketplace' || Boolean(String(input.employer || '').trim()))
  return {
    title: String(input.title || '').trim() || 'Untitled freelance task',
    employer,
    worker: openTask ? '' : participantName(input.worker, wallets().worker || 'Worker'),
    openTask,
    scope,
    requirements: scope,
    acceptanceCriteria,
    amountSol,
    milestones: makeMilestones(input.milestones, amountSol, scope, acceptanceCriteria),
  }
}

function hydrateMilestone(item: unknown, i: number, amountSol: number): Milestone | null {
  if (!item || typeof item !== 'object') return null
  const source = item as Partial<Milestone>
  const title = String(source.title || '').trim()
  if (!title) return null
  return {
    id: String(source.id || `ms_${i + 1}`),
    title,
    description: String(source.description || ''),
    amountSol: Number(source.amountSol || amountSol),
    status: source.status === 'complete' ? 'complete' : 'pending',
    ...(source.completedAt ? { completedAt: String(source.completedAt) } : {}),
  }
}

function hydrateDispute(item: unknown): Dispute | null {
  if (!item || typeof item !== 'object') return null
  const source = item as Partial<Dispute>
  const note = String(source.note || '').trim()
  if (!note) return null
  return {
    at: String(source.at || now()),
    by: source.by === 'worker' ? 'worker' : 'employer',
    note,
    status: source.status === 'resolved' ? 'resolved' : 'open',
    ...(source.outcome ? { outcome: source.outcome } : {}),
    ...(source.reviewedAt ? { reviewedAt: String(source.reviewedAt) } : {}),
    ...(source.summary ? { summary: String(source.summary) } : {}),
  }
}

function hydrateBid(item: unknown): MarketplaceBid | null {
  if (!item || typeof item !== 'object') return null
  const source = item as Partial<MarketplaceBid>
  const by = String(source.by || '').trim()
  const wallet = String(source.wallet || '').trim()
  const priceSol = Number(source.priceSol)
  if (!by || !wallet || !Number.isFinite(priceSol) || priceSol <= 0) return null
  return {
    at: String(source.at || now()),
    round: Number(source.round || 1),
    by,
    wallet,
    priceSol,
    ...(source.note ? { note: String(source.note) } : {}),
  }
}

function hydrateMarketplace(input: unknown, amountSol: number): MarketplaceState | undefined {
  if (!input || typeof input !== 'object') return undefined
  const source = input as Partial<MarketplaceState>
  const bids = Array.isArray(source.bids) ? source.bids.map(hydrateBid).filter((bid): bid is MarketplaceBid => Boolean(bid)) : []
  const awardedBid = hydrateBid(source.awardedBid)
  return {
    round: Number(source.round || 1),
    status: source.status === 'awarded' || source.status === 'delivered' || source.status === 'settled' || source.status === 'refunded' ? source.status : 'open',
    budgetSol: Number(source.budgetSol || amountSol),
    bids,
    ...(awardedBid ? { awardedBid } : {}),
    ...(source.bidWindowEndsAt ? { bidWindowEndsAt: String(source.bidWindowEndsAt) } : {}),
    ...(source.awardError ? { awardError: String(source.awardError) } : {}),
    ...(source.threadId ? { threadId: String(source.threadId) } : {}),
  }
}

function hydrateDevnetEscrow(input: unknown): DevnetEscrow | undefined {
  if (!input || typeof input !== 'object') return undefined
  const source = input as Partial<DevnetEscrow>
  if (!source.buyer || !source.seller || !source.reference || !source.escrow) return undefined
  return {
    buyer: String(source.buyer),
    seller: String(source.seller),
    reference: String(source.reference),
    escrow: String(source.escrow),
    amountSol: Number(source.amountSol || 0),
    deadlineAt: String(source.deadlineAt || deadlineFromNowSecs()),
    ...(source.deposit ? { deposit: String(source.deposit) } : {}),
    ...(source.release ? { release: String(source.release) } : {}),
    ...(source.refund ? { refund: String(source.refund) } : {}),
  }
}

function hydrateJob(input: unknown): Job | null {
  if (!input || typeof input !== 'object') return null
  const source = input as Partial<Job>
  if (!source.id) return null
  const title = String(source.title || 'Untitled freelance task')
  const amountSol = Math.max(0.001, Number(source.amountSol) || 0.001)
  const scope = String(source.scope || source.requirements || '')
  const acceptanceCriteria = String(source.acceptanceCriteria || '')
  const reference = String(source.reference || referenceFor(`freelance:${source.id}:${title}`))
  const status = statuses.has(source.status as Status) ? source.status as Status : 'funded'
  const milestones = Array.isArray(source.milestones)
    ? source.milestones.map((m, i) => hydrateMilestone(m, i, amountSol)).filter((m): m is Milestone => Boolean(m))
    : []
  const devnet = hydrateDevnetEscrow(source.settlement?.devnet)
  const marketplace = hydrateMarketplace(source.marketplace, amountSol)
  return {
    id: String(source.id),
    status,
    createdAt: String(source.createdAt || now()),
    title,
    employer: String(source.employer || wallets().employer || 'Employer'),
    worker: status === 'open' ? String(source.worker || '') : String(source.worker || wallets().worker || 'Worker'),
    scope,
    requirements: String(source.requirements || scope),
    acceptanceCriteria,
    amountSol,
    milestones: milestones.length ? milestones : makeMilestones(undefined, amountSol, scope, acceptanceCriteria),
    reference,
    messages: Array.isArray(source.messages) ? source.messages : [],
    ...(source.submission ? { submission: source.submission } : {}),
    ...(source.review ? { review: source.review } : {}),
    disputes: Array.isArray(source.disputes) ? source.disputes.map(hydrateDispute).filter((d): d is Dispute => Boolean(d)) : [],
    ...(marketplace ? { marketplace } : {}),
    settlement: {
      mode: devnet || source.settlement?.mode === 'devnet-escrow' ? 'devnet-escrow' : 'local-demo',
      escrow: source.settlement?.escrow || devnet?.escrow || `local-${reference.slice(0, 12)}`,
      ...(source.settlement?.release ? { release: source.settlement.release } : {}),
      ...(source.settlement?.refund ? { refund: source.settlement.refund } : {}),
      ...(devnet ? { devnet } : {}),
      events: Array.isArray(source.settlement?.events) ? source.settlement.events : [],
    },
    events: Array.isArray(source.events) ? source.events : [],
  }
}

export function createJob(input: Record<string, unknown>): Job {
  const { openTask, ...payload } = normalizeBody(input)
  if (payload.scope.length < 12 || payload.acceptanceCriteria.length < 12) {
    fail('scope and acceptance criteria must be specific')
  }
  const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  const reference = referenceFor(`freelance:${id}:${JSON.stringify(payload)}`)
  const job: Job = {
    id,
    status: openTask ? 'open' : 'funded',
    createdAt: now(),
    ...payload,
    reference,
    messages: [],
    disputes: [],
    ...(openTask ? { marketplace: { round: 1, status: 'open' as const, budgetSol: payload.amountSol, bids: [] } } : {}),
    settlement: { mode: 'local-demo', escrow: `local-${reference.slice(0, 12)}`, events: [] },
    events: [],
  }
  if (openTask) {
    addEvent(job, 'employer', 'posted', `Task posted with ${job.amountSol} SOL budget`)
  } else {
    addEvent(job, 'employer', 'funded', `Escrow opened for ${job.amountSol} SOL`)
    addSettlementEvent(job, 'funded', `Local escrow funded for ${job.worker}`)
  }
  jobs.set(id, job)
  return job
}

export function claimJob(job: Job, input: Record<string, unknown>): Job {
  ensureStatus(job, ['open'], 'claim')
  const worker = participantName(input.worker || input.organization || input.name, wallets().worker || 'Worker')
  job.worker = worker
  job.status = 'funded'
  if (job.marketplace) job.marketplace.status = 'awarded'
  addEvent(job, 'worker', 'claimed', `${worker} claimed the task`)
  addSettlementEvent(job, 'funded', `Local escrow funded for ${job.worker}`)
  return job
}

export function submitJob(job: Job, input: Record<string, unknown>): Submission {
  ensureStatus(job, ['funded', 'submitted', 'revision_requested'], 'submit evidence for')
  const submission = {
    at: now(),
    url: String(input.url || '').trim(),
    repo: String(input.repo || '').trim(),
    notes: String(input.notes || '').trim(),
  }
  if (!submission.url && !submission.repo && !submission.notes) fail('submission evidence is required')
  job.submission = submission
  job.status = 'submitted'
  addEvent(job, 'worker', 'submitted', 'Worker submitted delivery evidence')
  addSettlementEvent(job, 'submitted', 'Delivery evidence attached to the funded escrow')
  return submission
}

interface DevnetEscrowAdapterInput {
  buyer: Keypair
  seller: PublicKey
  reference: PublicKey
  amountSol: number
  deadlineSecs: number
  rpcUrl: string
}

export interface DevnetEscrowAdapter {
  deposit(input: DevnetEscrowAdapterInput): Promise<string>
  release(input: DevnetEscrowAdapterInput): Promise<string>
  refund(input: DevnetEscrowAdapterInput): Promise<string>
}

const liveDevnetEscrowAdapter: DevnetEscrowAdapter = {
  async deposit(input) {
    const program = await makeProgram(input.buyer, input.rpcUrl)
    return escrowDeposit(program, input.buyer, input.seller, input.reference, input.amountSol, input.deadlineSecs)
  },
  async release(input) {
    const program = await makeProgram(input.buyer, input.rpcUrl)
    return escrowRelease(program, input.buyer, input.seller, input.reference)
  },
  async refund(input) {
    const program = await makeProgram(input.buyer, input.rpcUrl)
    return escrowRefund(program, input.buyer, input.reference)
  },
}

function ensureMarketplace(job: Job): MarketplaceState {
  if (!job.marketplace) {
    job.marketplace = { round: 1, status: 'open', budgetSol: job.amountSol, bids: [] }
  }
  return job.marketplace
}

function buyerKeypair(): Keypair {
  const buyer = keypair('BUYER_KEYPAIR_B58')
  if (!buyer) fail('BUYER_KEYPAIR_B58 is required for devnet escrow', 503)
  return buyer
}

function escrowInput(job: Job): DevnetEscrowAdapterInput {
  const devnet = job.settlement.devnet
  if (!devnet) fail('devnet escrow is required', 409)
  const buyer = buyerKeypair()
  const seller = publicKey(devnet.seller)
  const reference = publicKey(devnet.reference)
  if (!seller || !reference) fail('devnet escrow state is invalid', 409)
  return {
    buyer,
    seller,
    reference,
    amountSol: devnet.amountSol,
    deadlineSecs: ESCROW_DEADLINE_SECS,
    rpcUrl: process.env.SOLANA_RPC_URL || DEFAULT_RPC_URL,
  }
}

export function recordAgentBid(job: Job, input: Record<string, unknown>): MarketplaceBid {
  ensureStatus(job, ['open'], 'bid on')
  const marketplace = ensureMarketplace(job)
  if (marketplace.awardedBid) fail('job already awarded', 409)
  const by = String(input.by || input.agent || '').trim()
  const wallet = String(input.wallet || '').trim()
  const priceSol = Number(input.priceSol ?? input.price)
  const round = Number(input.round || marketplace.round || 1)
  if (!by) fail('bid agent is required')
  if (!publicKey(wallet)) fail('valid bid wallet is required')
  if (!Number.isFinite(priceSol) || priceSol <= 0) fail('valid bid price is required')
  if (priceSol > marketplace.budgetSol) fail('bid exceeds posted budget', 409)
  const hadBids = marketplace.bids.some((item) => item.round === round)
  const bid: MarketplaceBid = {
    at: now(),
    round,
    by,
    wallet,
    priceSol,
    ...(input.note ? { note: String(input.note) } : {}),
  }
  marketplace.bids = marketplace.bids.filter((item) => !(item.round === round && item.by === by))
  marketplace.bids.push(bid)
  if (!hadBids && !marketplace.bidWindowEndsAt) marketplace.bidWindowEndsAt = new Date(Date.now() + BID_WINDOW_MS).toISOString()
  delete marketplace.awardError
  addEvent(job, 'agent', 'bid', `${by} bid ${priceSol} SOL`)
  return bid
}

export async function awardAgentBid(
  job: Job,
  input: Record<string, unknown> = {},
  adapter: DevnetEscrowAdapter = liveDevnetEscrowAdapter,
): Promise<MarketplaceBid> {
  ensureStatus(job, ['open'], 'award')
  const marketplace = ensureMarketplace(job)
  if (marketplace.awardedBid || job.settlement.mode === 'devnet-escrow') fail('job already awarded', 409)
  const round = Number(input.round || marketplace.round || 1)
  const bids = marketplace.bids.filter((bid) => bid.round === round && bid.priceSol > 0 && bid.priceSol <= marketplace.budgetSol)
  const requestedBy = String(input.by || '').trim()
  const winner = requestedBy
    ? bids.find((bid) => bid.by === requestedBy)
    : [...bids].sort((a, b) => a.priceSol - b.priceSol)[0]
  if (!winner) fail('no valid bid to award', 409)
  const buyer = buyerKeypair()
  const seller = publicKey(winner.wallet)
  const reference = publicKey(job.reference)
  if (!seller || !reference) fail('award wallet or reference is invalid', 409)
  const rawDeadlineSecs = Number(input.deadlineSecs || ESCROW_DEADLINE_SECS)
  const deadlineSecs = Number.isFinite(rawDeadlineSecs) && rawDeadlineSecs > 0 ? rawDeadlineSecs : ESCROW_DEADLINE_SECS
  const deadlineAt = deadlineFromNowSecs(deadlineSecs)
  const rpcUrl = process.env.SOLANA_RPC_URL || DEFAULT_RPC_URL
  const depositSig = await adapter.deposit({ buyer, seller, reference, amountSol: winner.priceSol, deadlineSecs, rpcUrl })
  const escrow = escrowPda(buyer.publicKey, reference).toBase58()
  marketplace.status = 'awarded'
  marketplace.awardedBid = winner
  delete marketplace.awardError
  job.worker = winner.by
  job.amountSol = winner.priceSol
  job.status = 'funded'
  job.settlement = {
    mode: 'devnet-escrow',
    escrow,
    devnet: {
      buyer: buyer.publicKey.toBase58(),
      seller: seller.toBase58(),
      reference: reference.toBase58(),
      escrow,
      amountSol: winner.priceSol,
      deadlineAt,
      deposit: depositSig,
    },
    events: job.settlement.events,
  }
  addEvent(job, 'agent', 'awarded', `${winner.by} won at ${winner.priceSol} SOL`)
  addSettlementEvent(job, 'funded', `Devnet escrow funded for ${winner.by}`)
  return winner
}

export function submitAgentDelivery(job: Job, input: Record<string, unknown>): Submission {
  if (job.settlement.mode !== 'devnet-escrow') fail('agent delivery requires devnet escrow', 409)
  const marketplace = ensureMarketplace(job)
  const by = String(input.by || input.agent || '').trim()
  if (marketplace.awardedBid && by && by !== marketplace.awardedBid.by) fail('only the awarded agent can deliver', 403)
  const submission = submitJob(job, input)
  marketplace.status = 'delivered'
  delete marketplace.awardError
  addEvent(job, 'agent', 'delivered', `${by || job.worker} submitted agent delivery`)
  return submission
}

function markDevnetReleased(job: Job, sig: string): void {
  const releasedAt = now()
  job.status = 'released'
  job.settlement.release = sig
  if (job.settlement.devnet) job.settlement.devnet.release = sig
  if (job.marketplace) job.marketplace.status = 'settled'
  job.milestones = job.milestones.map((m) => ({ ...m, status: 'complete', completedAt: m.completedAt || releasedAt }))
  addSettlementEvent(job, 'released', `Released ${job.amountSol} SOL to ${job.worker} on devnet`)
  addEvent(job, 'agent', 'released', 'Agent settlement released devnet escrow')
}

function markDevnetRefunded(job: Job, sig: string): void {
  job.status = 'refunded'
  job.settlement.refund = sig
  if (job.settlement.devnet) job.settlement.devnet.refund = sig
  if (job.marketplace) job.marketplace.status = 'refunded'
  addSettlementEvent(job, 'refunded', `Refunded ${job.amountSol} SOL to ${job.employer} on devnet`)
  addEvent(job, 'agent', 'refunded', 'Agent settlement refunded devnet escrow')
}

export async function settleAgentEscrow(
  job: Job,
  adapter: DevnetEscrowAdapter = liveDevnetEscrowAdapter,
  at = new Date(),
): Promise<'released' | 'refunded' | null> {
  if (job.settlement.mode !== 'devnet-escrow' || !job.settlement.devnet) fail('devnet escrow is required', 409)
  if (job.settlement.devnet.release || job.settlement.devnet.refund || terminal.has(job.status)) return null
  const input = escrowInput(job)
  const releaseAt = job.review?.autoReleaseAt || (job.review?.releaseEligible ? deadlineFrom(job.review.at) : '')
  if (job.review?.releaseEligible && releaseAt && new Date(releaseAt).getTime() <= at.getTime() && !activeDispute(job)) {
    markDevnetReleased(job, await adapter.release(input))
    return 'released'
  }
  const escrowExpired = new Date(job.settlement.devnet.deadlineAt).getTime() <= at.getTime()
  const reviewedAndRejected = Boolean(job.review && job.review.source !== 'fallback' && !job.review.releaseEligible)
  if (escrowExpired && !job.review?.releaseEligible && (!job.submission || reviewedAndRejected)) {
    markDevnetRefunded(job, await adapter.refund(input))
    return 'refunded'
  }
  return null
}

export async function runAgentMarketTick(
  adapter: DevnetEscrowAdapter = liveDevnetEscrowAdapter,
  at = new Date(),
): Promise<number> {
  let changed = 0
  for (const job of jobs.values()) {
    const market = job.marketplace
    if (!market) continue
    if (job.status === 'open' && market.bids.length && !market.awardedBid) {
      const endsAt = market.bidWindowEndsAt ? new Date(market.bidWindowEndsAt).getTime() : at.getTime()
      if (endsAt <= at.getTime()) {
        try {
          await awardAgentBid(job, { deadlineSecs: ESCROW_DEADLINE_SECS }, adapter)
          changed += 1
        } catch (e) {
          if (job.status !== 'open' || market.awardedBid) continue
          const message = (e as Error).message
          if (market.awardError !== message) {
            market.awardError = message
            addEvent(job, 'system', 'award_error', message)
            changed += 1
          }
        }
      }
    }
    if (job.settlement.mode === 'devnet-escrow' && !terminal.has(job.status)) {
      try {
        if (await settleAgentEscrow(job, adapter, at)) changed += 1
      } catch {
        // Settlement can remain pending until review/deadline/network state changes.
      }
    }
  }
  return changed
}

type ReviewCompletion = (opts: { system: string; user: string; maxTokens?: number }) => Promise<string>
type ArtifactCollector = (job: Job) => Promise<ArtifactRun>
type CommandResult = { ok: boolean; code: number | null; timedOut: boolean; output: string }

interface AiReviewReply {
  score?: unknown
  recommendation?: unknown
  summary?: unknown
  checks?: unknown
  criteriaResults?: unknown
  missing?: unknown
  risks?: unknown
  confidence?: unknown
  criticalRisks?: unknown
  releaseEligible?: unknown
  revisionInstructions?: unknown
}

const REVIEW_SYSTEM = `You are the escrow review agent for a freelance marketplace.
Review the job against the artifact evidence collected by the backend: repository scan, build result, preview metadata, screenshots, worker notes, messages, milestones, scope, and acceptance criteria.
When reviewing a dispute, judge the dispute reason against the same evidence and worker/employer messages. Do not treat refusal to pay as evidence by itself.
Reject keyword stuffing, generic promises, unsupported claims, and links that could not be inspected. Use unclear when evidence is incomplete.
Approve only when every material acceptance item is demonstrated by inspected artifacts.
Return only JSON with this shape: {"score":0-100,"recommendation":"approve|revision|dispute","confidence":0-100,"summary":"...","criteriaResults":[{"label":"...","status":"pass|fail|unclear","reason":"...","evidence":"..."}],"missing":["..."],"criticalRisks":["..."],"risks":["..."],"releaseEligible":false,"revisionInstructions":"..."}.`

function safeReviewEnv(): NodeJS.ProcessEnv {
  const keys = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
  return Object.fromEntries(keys.flatMap((key) => process.env[key] ? [[key, process.env[key] as string]] : []))
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function artifactFile(file: string) {
  return path.relative(REVIEW_DIR, file).replace(/\\/g, '/')
}

async function addArtifact(run: ArtifactRun, dir: string, kind: ArtifactKind, label: string, fileName: string, content: string | Buffer, mime: string): Promise<ReviewArtifact> {
  const file = path.join(dir, fileName)
  await fs.writeFile(file, content)
  const artifact = { id: `${run.id}_${fileName.replace(/[^a-z0-9.]+/gi, '_')}`, kind, label, file: artifactFile(file), mime }
  if (kind === 'screenshot') run.screenshots.push(artifact)
  else run.logs.push(artifact)
  return artifact
}

function trimLog(input: string) {
  return input.length > MAX_LOG_CHARS ? input.slice(-MAX_LOG_CHARS) : input
}

function runCommand(command: string, args: string[], cwd: string, timeoutMs = REVIEW_TIMEOUT_MS): Promise<CommandResult> {
  return new Promise((resolve) => {
    let output = ''
    let timedOut = false
    const child = spawn(command, args, { cwd, env: safeReviewEnv(), windowsHide: true })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { output = trimLog(output + chunk.toString()) })
    child.stderr.on('data', (chunk) => { output = trimLog(output + chunk.toString()) })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, code: null, timedOut, output: trimLog(`${output}\n${error.message}`) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0 && !timedOut, code, timedOut, output: trimLog(output) })
    })
  })
}

function githubCloneUrl(input: string): string | null {
  try {
    const url = new URL(input.trim())
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') return null
    const [owner, repo] = url.pathname.replace(/\.git$/i, '').split('/').filter(Boolean)
    if (!owner || !repo) return null
    return `https://github.com/${owner}/${repo}.git`
  } catch {
    return null
  }
}

async function exists(file: string) {
  try { await fs.access(file); return true } catch { return false }
}

async function readJsonFile<T = Record<string, unknown>>(file: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T } catch { return null }
}

async function detectPackageManager(repoDir: string): Promise<string> {
  if (await exists(path.join(repoDir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await exists(path.join(repoDir, 'yarn.lock'))) return 'yarn'
  if (await exists(path.join(repoDir, 'bun.lockb')) || await exists(path.join(repoDir, 'bun.lock'))) return 'bun'
  return 'npm'
}

async function walkRepoFiles(root: string, dir = root, out: string[] = []): Promise<string[]> {
  if (out.length >= 24) return out
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (out.length >= 24) break
    if (['.git', 'node_modules', 'dist', 'build', '.next', 'coverage'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    const rel = path.relative(root, full).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      if (rel.split('/').length <= 3) await walkRepoFiles(root, full, out)
    } else if (/^(readme|package\.json)|\.(tsx?|jsx?|css|html|md)$/i.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

async function scanRepo(repoDir: string): Promise<Pick<RepoArtifact, 'packageManager' | 'scripts' | 'files'>> {
  const pkg = await readJsonFile<{ scripts?: Record<string, string> }>(path.join(repoDir, 'package.json'))
  const files = []
  for (const file of await walkRepoFiles(repoDir)) {
    const stat = await fs.stat(file).catch(() => null)
    if (!stat || stat.size > 120_000) continue
    files.push({
      path: path.relative(repoDir, file).replace(/\\/g, '/'),
      snippet: (await fs.readFile(file, 'utf8')).slice(0, MAX_SNIPPET_CHARS),
    })
    if (files.length >= 12) break
  }
  return { packageManager: await detectPackageManager(repoDir), scripts: pkg?.scripts || {}, files }
}

async function findBuildOutput(repoDir: string): Promise<string | undefined> {
  for (const name of ['dist', 'build', 'out', 'public']) {
    const candidate = path.join(repoDir, name)
    if (await exists(candidate)) return candidate
  }
  return undefined
}

async function buildRepo(repoDir: string, run: ArtifactRun, dir: string): Promise<BuildArtifact> {
  const pkg = await readJsonFile<{ scripts?: Record<string, string> }>(path.join(repoDir, 'package.json'))
  if (!pkg?.scripts?.build) return { status: 'skipped', summary: 'No package build script found' }
  const npm = npmCommand()
  const hasLock = await exists(path.join(repoDir, 'package-lock.json'))
  const installArgs = hasLock ? ['ci', '--ignore-scripts', '--no-audit', '--no-fund'] : ['install', '--ignore-scripts', '--no-audit', '--no-fund']
  const install = await runCommand(npm, installArgs, repoDir)
  await addArtifact(run, dir, 'log', 'Install log', 'install.log', install.output || '(no output)', 'text/plain')
  if (!install.ok) return { status: 'fail', summary: install.timedOut ? 'Install timed out' : 'Install failed', command: `${npm} ${installArgs.join(' ')}`, log: install.output }
  const build = await runCommand(npm, ['run', 'build'], repoDir)
  await addArtifact(run, dir, 'log', 'Build log', 'build.log', build.output || '(no output)', 'text/plain')
  const outputDir = build.ok ? await findBuildOutput(repoDir) : undefined
  return {
    status: build.ok ? 'pass' : 'fail',
    summary: build.ok ? 'Build completed' : build.timedOut ? 'Build timed out' : 'Build failed',
    command: `${npm} run build`,
    ...(outputDir ? { outputDir } : {}),
    log: build.output,
  }
}

async function inspectPreview(url: string): Promise<PreviewArtifact> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    const contentType = res.headers.get('content-type') || ''
    const text = contentType.includes('text/html') ? (await res.text()).slice(0, 120_000) : ''
    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim()
    return { status: res.ok ? 'pass' : 'fail', summary: res.ok ? 'Preview URL loaded' : `Preview returned HTTP ${res.status}`, url, httpStatus: res.status, ...(title ? { title } : {}) }
  } catch (e) {
    return { status: 'fail', summary: 'Preview URL failed to load', url, error: (e as Error).message }
  }
}

async function serveStatic(root: string, fn: (url: string) => Promise<void>): Promise<void> {
  const server = http.createServer(async (req, res) => {
    try {
      const requested = decodeURIComponent(new URL(req.url || '/', 'http://local').pathname)
      const rel = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '')
      const file = path.resolve(root, rel)
      if (!file.startsWith(path.resolve(root))) {
        res.statusCode = 403; res.end('forbidden'); return
      }
      const stat = await fs.stat(file).catch(() => null)
      const chosen = stat?.isDirectory() ? path.join(file, 'index.html') : file
      res.end(await fs.readFile(chosen))
    } catch {
      res.statusCode = 404
      res.end('not found')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  try {
    await fn(`http://127.0.0.1:${port}/`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function takeScreenshots(targetUrl: string, run: ArtifactRun, dir: string, prefix: string): Promise<ArtifactResult> {
  try {
    const { chromium } = await import('playwright')
    const browser = await chromium.launch({ headless: true })
    try {
      for (const viewport of [
        { name: 'desktop', width: 1365, height: 900 },
        { name: 'mobile', width: 390, height: 844 },
      ]) {
        const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 25000 })
        const fileName = `${prefix}-${viewport.name}.png`
        const file = path.join(dir, fileName)
        await page.screenshot({ path: file, fullPage: true })
        run.screenshots.push({ id: `${run.id}_${fileName}`, kind: 'screenshot', label: `${prefix} ${viewport.name}`, file: artifactFile(file), mime: 'image/png' })
        await page.close()
      }
    } finally {
      await browser.close()
    }
    return { status: 'pass', summary: `${prefix} screenshots captured` }
  } catch (e) {
    await addArtifact(run, dir, 'log', `${prefix} screenshot error`, `${prefix}-screenshot.log`, (e as Error).message, 'text/plain')
    return { status: 'fail', summary: `${prefix} screenshot failed`, error: (e as Error).message }
  }
}

export async function collectReviewArtifacts(job: Job): Promise<ArtifactRun> {
  const run: ArtifactRun = {
    id: `review_${Date.now().toString(36)}`,
    at: now(),
    repo: { status: 'skipped', summary: 'No repository submitted' },
    build: { status: 'skipped', summary: 'No build attempted' },
    preview: { status: 'skipped', summary: 'No preview URL submitted' },
    screenshots: [],
    logs: [],
  }
  const dir = path.join(REVIEW_DIR, job.id, run.id)
  await fs.mkdir(dir, { recursive: true })
  if (job.submission?.repo) {
    const cloneUrl = githubCloneUrl(job.submission.repo)
    if (!cloneUrl) {
      run.repo = { status: 'fail', summary: 'Only public HTTPS GitHub repos are supported in v1', url: job.submission.repo }
    } else {
      const repoDir = path.join(dir, 'repo')
      const clone = await runCommand('git', ['clone', '--depth', '1', cloneUrl, repoDir], dir)
      await addArtifact(run, dir, 'log', 'Clone log', 'clone.log', clone.output || '(no output)', 'text/plain')
      if (!clone.ok) {
        run.repo = { status: 'fail', summary: clone.timedOut ? 'Repository clone timed out' : 'Repository clone failed', url: job.submission.repo, log: clone.output }
      } else {
        const commit = await runCommand('git', ['-C', repoDir, 'rev-parse', '--short', 'HEAD'], dir, 10000)
        run.repo = { status: 'pass', summary: 'Repository cloned and scanned', url: job.submission.repo, commit: commit.output.trim(), ...(await scanRepo(repoDir)) }
        run.build = await buildRepo(repoDir, run, dir)
        if (run.build.outputDir) {
          const outputDir = run.build.outputDir
          await serveStatic(outputDir, async (url) => {
            const shot = await takeScreenshots(url, run, dir, 'local-build')
            if (shot.status === 'fail') run.build = { ...run.build, status: 'fail', summary: shot.summary, error: shot.error }
          })
          run.build.outputDir = path.relative(dir, outputDir).replace(/\\/g, '/')
        }
      }
    }
  }
  if (job.submission?.url) {
    run.preview = await inspectPreview(job.submission.url)
    const shot = await takeScreenshots(job.submission.url, run, dir, 'preview')
    if (shot.status === 'fail') run.preview = { ...run.preview, status: 'fail', summary: shot.summary, error: shot.error }
  }
  return run
}

function textList(input: unknown, limit = 8): string[] {
  if (!Array.isArray(input)) return []
  return input.map((item) => String(item || '').trim()).filter(Boolean).slice(0, limit)
}

function reviewScore(input: unknown): number {
  const score = Number(input)
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0
}

function reviewRecommendation(input: unknown): ReviewRecommendation {
  return input === 'approve' || input === 'dispute' ? input : 'revision'
}

function reviewChecks(input: unknown): ReviewCheck[] {
  if (!Array.isArray(input)) return []
  return input.map((item, i) => {
    const source = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    const status: ReviewCheckStatus = source.status === 'pass' || source.status === 'fail' || source.status === 'unclear' ? source.status : 'unclear'
    return {
      label: String(source.label || `Check ${i + 1}`).trim(),
      status,
      reason: String(source.reason || '').trim(),
      evidence: String(source.evidence || '').trim(),
    }
  }).filter((item) => item.label).slice(0, 10)
}

function visualReviewRequired(job: Job): boolean {
  return /preview|screenshot|mobile|responsive|ui|ux|layout|page|frontend|design|visual/i.test(`${job.scope} ${job.acceptanceCriteria}`)
}

function artifactGateProblems(job: Job, run?: ArtifactRun): string[] {
  if (!run) return ['Artifact review did not run']
  const problems = []
  if (job.submission?.repo && run.repo.status !== 'pass') problems.push('Repository could not be inspected')
  if (run.build.status === 'fail') problems.push('Submitted project did not build cleanly')
  if (job.submission?.url && run.preview.status !== 'pass') problems.push('Preview URL could not be inspected')
  if (visualReviewRequired(job) && run.screenshots.length < 2) problems.push('Required visual screenshots were not captured')
  return problems
}

function releaseGateProblems(job: Job, review: Review, options: { ignoreActiveDispute?: boolean } = {}): string[] {
  const criteria = review.criteriaResults.length ? review.criteriaResults : review.checks
  return [
    ...(review.recommendation !== 'approve' ? ['AI did not recommend release'] : []),
    ...(review.score < 80 ? ['Review score is below 80'] : []),
    ...(!criteria.length ? ['Acceptance criteria were not checked'] : criteria.filter((check) => check.status !== 'pass').map((check) => `${check.label} is ${check.status}`)),
    ...review.missing,
    ...review.criticalRisks,
    ...artifactGateProblems(job, review.artifactRun),
    ...(!options.ignoreActiveDispute && activeDispute(job) ? ['An active dispute blocks release'] : []),
  ].filter(Boolean).slice(0, 12)
}

function finalizeReviewGates(job: Job, review: Review, options: { ignoreActiveDispute?: boolean } = {}): Review {
  const problems = releaseGateProblems(job, review, options)
  const missing = [...new Set([...review.missing, ...problems])]
  const releaseEligible = problems.length === 0
  return {
    ...review,
    missing: missing.slice(0, 12),
    releaseEligible,
    approved: releaseEligible,
    autoReleaseAt: releaseEligible ? review.autoReleaseAt || deadlineFrom(review.at) : undefined,
    revisionInstructions: review.revisionInstructions || (problems.length ? `Please address: ${problems.join('; ')}` : 'Ready for employer release.'),
  }
}

function fallbackReview(summary = 'AI review is unavailable; request clearer evidence or retry assessment.', artifactRun?: ArtifactRun): Review {
  return {
    at: now(),
    approved: false,
    score: 0,
    summary,
    missing: ['Reliable AI assessment'],
    source: 'fallback',
    recommendation: 'revision',
    checks: [],
    risks: ['No funds were released automatically.'],
    criteriaResults: [],
    ...(artifactRun ? { artifactRun } : {}),
    confidence: 0,
    criticalRisks: ['Reliable AI assessment is missing'],
    releaseEligible: false,
    revisionInstructions: summary,
  }
}

function reviewPrompt(job: Job, artifactRun?: ArtifactRun, mode: 'delivery' | 'dispute' = 'delivery'): string {
  return JSON.stringify({
    mode,
    job: {
      title: job.title,
      status: job.status,
      employer: job.employer,
      worker: job.worker,
      amountSol: job.amountSol,
      scope: job.scope,
      acceptanceCriteria: job.acceptanceCriteria,
      milestones: job.milestones.map(({ title, description, status }) => ({ title, description, status })),
      messages: job.messages.slice(-20),
      submission: job.submission,
      disputes: job.disputes,
      activity: job.events.slice(0, 20).reverse(),
    },
    artifactRun,
    releasePolicy: {
      minimumScore: 80,
      requireEveryCriterionPass: true,
      requireNoCriticalRisks: true,
      requireScreenshotsForVisualWork: visualReviewRequired(job),
      finalReleaseBy: mode === 'dispute' ? 'backend after unsupported dispute' : 'employer or auto-release timeout',
      disputeRule: 'If the employer dispute is not supported by the platform-visible evidence and all release gates pass, recommend approve. If evidence is incomplete, recommend revision. Use dispute only for unresolved fraud, safety, or contract ambiguity.',
    },
  }, null, 2)
}

function normalizeAiReview(job: Job, artifactRun: ArtifactRun, reply: AiReviewReply | null, gateOptions: { ignoreActiveDispute?: boolean } = {}): Review | null {
  if (!reply) return null
  const criteriaResults = reviewChecks(reply.criteriaResults || reply.checks)
  const checks = criteriaResults.length ? criteriaResults : reviewChecks(reply.checks)
  const missing = textList(reply.missing)
  let recommendation = reviewRecommendation(reply.recommendation)
  if (recommendation === 'approve' && (!checks.length || checks.some((check) => check.status !== 'pass') || missing.length)) {
    recommendation = 'revision'
  }
  const review: Review = {
    at: now(),
    approved: false,
    score: reviewScore(reply.score),
    summary: String(reply.summary || '').trim() || 'AI review completed.',
    missing: recommendation === 'revision' && !missing.length ? ['Clearer delivery evidence'] : missing,
    source: 'ai',
    recommendation,
    checks,
    risks: textList(reply.risks),
    criteriaResults,
    artifactRun,
    confidence: reviewScore(reply.confidence),
    criticalRisks: textList(reply.criticalRisks),
    releaseEligible: false,
    revisionInstructions: String(reply.revisionInstructions || '').trim(),
  }
  return finalizeReviewGates(job, review, gateOptions)
}

export function reviewJob(job: Job): Review {
  ensureStatus(job, ['submitted', 'revision_requested'], 'review')
  if (!job.submission) fail('worker submission is required')
  const haystack = `${job.submission.url} ${job.submission.repo} ${job.submission.notes}`.toLowerCase()
  const terms = `${job.scope} ${job.acceptanceCriteria}`.toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 4)
  const hits = new Set(terms.filter((w) => haystack.includes(w)))
  const hasEvidence = Boolean(job.submission.url || job.submission.repo || job.submission.notes.length > 30)
  const score = Math.min(100, Math.round((hits.size / Math.max(1, terms.length)) * 70 + (hasEvidence ? 30 : 0)))
  const missing = [...new Set(terms.filter((w) => !hits.has(w)))].slice(0, 5)
  const review = {
    at: now(),
    approved: score >= 45 && hasEvidence,
    score,
    summary: score >= 45 && hasEvidence
      ? 'Delivery includes enough evidence to release the local demo escrow.'
      : 'Delivery needs clearer evidence before release.',
    missing,
    source: 'legacy-heuristic' as const,
    recommendation: (score >= 45 && hasEvidence ? 'approve' : 'revision') as ReviewRecommendation,
    checks: [],
    risks: [],
    criteriaResults: [],
    confidence: score,
    criticalRisks: [],
    releaseEligible: score >= 45 && hasEvidence,
    revisionInstructions: score >= 45 && hasEvidence ? '' : 'Provide clearer delivery evidence before release.',
  }
  job.review = review
  job.status = review.approved ? 'released' : 'revision_requested'
  if (review.approved) {
    job.settlement.release = `demo-release-${job.reference.slice(0, 10)}`
    job.milestones = job.milestones.map((m) => ({ ...m, status: 'complete', completedAt: m.completedAt || review.at }))
    addSettlementEvent(job, 'released', `Released ${job.amountSol} SOL to ${job.worker}`)
  } else {
    addSettlementEvent(job, 'reviewed', 'Review requested clearer delivery evidence')
  }
  addEvent(job, 'agent', review.approved ? 'released' : 'revision_requested', review.summary)
  return review
}

async function runAiReview(
  job: Job,
  mode: 'delivery' | 'dispute',
  reviewer: ReviewCompletion,
  collectArtifacts: ArtifactCollector,
  gateOptions: { ignoreActiveDispute?: boolean } = {},
): Promise<Review> {
  let review: Review
  let artifactRun: ArtifactRun | undefined
  try {
    artifactRun = await collectArtifacts(job)
    review = normalizeAiReview(job, artifactRun, parseJsonReply<AiReviewReply>(await reviewer({
      system: REVIEW_SYSTEM,
      user: reviewPrompt(job, artifactRun, mode),
      maxTokens: 2000,
    })), gateOptions) ?? finalizeReviewGates(job, fallbackReview('AI review returned an unreadable assessment; request clearer evidence or retry.', artifactRun), gateOptions)
  } catch {
    review = finalizeReviewGates(job, fallbackReview('Artifact or AI review failed; request clearer evidence or retry assessment.', artifactRun), gateOptions)
  }
  return review
}

export async function assessJobWithAi(job: Job, reviewer: ReviewCompletion = complete, collectArtifacts: ArtifactCollector = collectReviewArtifacts): Promise<Review> {
  ensureStatus(job, ['submitted', 'revision_requested'], 'review')
  if (!job.submission) fail('worker submission is required')
  const review = await runAiReview(job, 'delivery', reviewer, collectArtifacts)
  job.review = review
  addEvent(job, 'agent', 'ai_reviewed', review.summary)
  addSettlementEvent(job, 'reviewed', review.releaseEligible ? 'Artifact review passed; employer release is enabled' : 'Artifact review requested clearer delivery evidence')
  return review
}

function releaseReviewedJob(job: Job, actor: Actor, summary: string): Review {
  if (!job.review) fail('AI review is required before release', 409)
  const releasedAt = now()
  job.review = { ...job.review, approved: true, recommendation: 'approve' }
  job.status = 'released'
  job.settlement.release = `demo-release-${job.reference.slice(0, 10)}`
  job.milestones = job.milestones.map((m) => ({ ...m, status: 'complete', completedAt: m.completedAt || releasedAt }))
  addSettlementEvent(job, 'released', `Released ${job.amountSol} SOL to ${job.worker}`)
  addEvent(job, actor, 'released', summary)
  return job.review
}

export function approveReviewedJob(job: Job, input: Record<string, unknown> = {}): Review {
  ensureStatus(job, ['submitted', 'revision_requested'], 'approve')
  if (!job.submission) fail('worker submission is required')
  if (!job.review) fail('AI review is required before release', 409)
  if (!job.review.releaseEligible) fail('review gates do not allow release', 409)
  if (job.settlement.mode === 'devnet-escrow') fail('devnet escrow release uses agent settlement', 409)
  return releaseReviewedJob(job, 'employer', 'Employer approved delivery after AI review')
}

export function requestRevisionJob(job: Job, input: Record<string, unknown> = {}): Review {
  ensureStatus(job, ['submitted', 'revision_requested'], 'request revision for')
  if (!job.submission) fail('worker submission is required')
  const note = String(input.note || job.review?.missing?.join('; ') || 'Please address the review notes and resubmit evidence.').trim()
  const review = job.review || fallbackReview(note)
  job.review = { ...review, approved: false, recommendation: 'revision' }
  job.status = 'revision_requested'
  addSettlementEvent(job, 'reviewed', note)
  addEvent(job, 'employer', 'revision_requested', note)
  return job.review
}

function resolveActiveDispute(job: Job, outcome: NonNullable<Dispute['outcome']>, summary: string): void {
  const dispute = activeDispute(job)
  if (!dispute) return
  dispute.status = 'resolved'
  dispute.outcome = outcome
  dispute.reviewedAt = now()
  dispute.summary = summary
}

export function disputeJob(job: Job, input: Record<string, unknown>): Dispute {
  ensureStatus(job, ['funded', 'submitted', 'approved', 'revision_requested', 'disputed'], 'dispute')
  const by: Dispute['by'] = input.by === 'worker' ? 'worker' : 'employer'
  if (activeDispute(job)) fail('dispute already open', 409)
  const note = String(input.note || '').trim()
  if (job.review?.releaseEligible && note.length < 20) fail('dispute reason must explain the acceptance issue', 400)
  const dispute = {
    at: now(),
    by,
    note: note || 'Dispute opened for manual review',
    status: 'open' as const,
  }
  job.disputes.unshift(dispute)
  job.status = 'disputed'
  addEvent(job, dispute.by, 'disputed', dispute.note)
  addSettlementEvent(job, 'disputed', dispute.note)
  return dispute
}

export async function assessDisputeWithAi(job: Job, reviewer: ReviewCompletion = complete, collectArtifacts: ArtifactCollector = collectReviewArtifacts): Promise<Review> {
  ensureStatus(job, ['disputed'], 'review dispute for')
  if (!job.submission) fail('worker submission is required')
  if (!activeDispute(job)) fail('no active dispute to review', 409)
  const review = await runAiReview(job, 'dispute', reviewer, collectArtifacts, { ignoreActiveDispute: true })
  job.review = review
  if (review.releaseEligible) {
    resolveActiveDispute(job, 'release', review.summary)
    releaseReviewedJob(job, 'agent', 'AI dispute review found the dispute unsupported and released escrow')
  } else if (review.recommendation === 'revision') {
    resolveActiveDispute(job, 'revision', review.revisionInstructions || review.summary)
    job.status = 'revision_requested'
    addSettlementEvent(job, 'reviewed', 'Dispute review requested worker revision')
    addEvent(job, 'agent', 'revision_requested', review.revisionInstructions || review.summary)
  } else {
    addSettlementEvent(job, 'reviewed', 'Dispute review could not safely settle the escrow')
    addEvent(job, 'agent', 'dispute_reviewed', review.summary)
  }
  return job.review
}

export function autoReleaseExpiredJobs(at = new Date()): number {
  let released = 0
  for (const job of jobs.values()) {
    if (job.settlement.mode === 'devnet-escrow') continue
    if (!['submitted', 'revision_requested'].includes(job.status)) continue
    const deadline = job.review?.autoReleaseAt || (job.review?.releaseEligible ? deadlineFrom(job.review.at) : '')
    if (!job.review?.releaseEligible || !deadline || activeDispute(job)) continue
    if (new Date(deadline).getTime() > at.getTime()) continue
    job.review.autoReleaseAt = deadline
    releaseReviewedJob(job, 'system', 'Auto-released after the employer dispute window expired')
    released += 1
  }
  return released
}

export function refundJob(job: Job): void {
  ensureStatus(job, ['funded', 'submitted', 'revision_requested', 'disputed'], 'refund')
  if (job.settlement.mode === 'devnet-escrow') fail('devnet escrow refund uses agent settlement', 409)
  job.status = 'refunded'
  job.settlement.refund = `demo-refund-${job.reference.slice(0, 10)}`
  addEvent(job, 'system', 'refunded', 'Local demo escrow refunded')
  addSettlementEvent(job, 'refunded', `Refunded ${job.amountSol} SOL to ${job.employer}`)
}

export function cancelJob(job: Job): void {
  ensureStatus(job, ['open', 'funded', 'revision_requested'], 'cancel')
  if (job.submission) fail('cannot cancel after worker submission; dispute or refund instead', 409)
  job.status = 'cancelled'
  addEvent(job, 'employer', 'cancelled', 'Job cancelled')
  addSettlementEvent(job, 'cancelled', job.worker ? 'Local escrow cancelled before delivery' : 'Open task cancelled before claim')
}

export function completeMilestone(job: Job, milestoneId: string, actor: Actor = 'worker'): Milestone {
  ensureStatus(job, ['funded', 'submitted', 'revision_requested'], 'complete milestones for')
  const milestone = job.milestones.find((m) => m.id === milestoneId)
  if (!milestone) fail('milestone not found', 404)
  if (milestone.status !== 'complete') {
    milestone.status = 'complete'
    milestone.completedAt = now()
    addEvent(job, actor, 'milestone_complete', milestone.title)
  }
  return milestone
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  if (!chunks.length) return {}
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail('JSON body must be an object')
    return data as Record<string, unknown>
  } catch (e) {
    if ((e as { status?: number }).status) throw e
    fail('invalid JSON body')
  }
}

function requireLocalRequest(req: http.IncomingMessage): void {
  const address = req.socket.remoteAddress || ''
  const local = address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1'
    || address.startsWith('::ffff:127.')
  if (!local) fail('demo runner is local only', 403)
}

function requireAgentAuth(req: http.IncomingMessage): AgentAuth {
  const platformToken = process.env.AGENT_API_TOKEN?.trim()
  const raw = req.headers.authorization
  const auth = Array.isArray(raw) ? raw[0] : raw
  const token = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!token && !platformToken && !connectedAgents.size) fail('agent API is disabled; create an agent or set AGENT_API_TOKEN', 503)
  if (!token) fail('agent API token is invalid', 401)
  if (platformToken && token === platformToken) return { kind: 'platform' }
  const tokenHash = hashToken(token)
  const agent = [...connectedAgents.values()].find((item) => item.status === 'active' && item.tokenHash === tokenHash)
  if (!agent) {
    if (!platformToken && !connectedAgents.size) fail('agent API is disabled; create an agent or set AGENT_API_TOKEN', 503)
    fail('agent API token is invalid', 401)
  }
  agent.lastSeenAt = now()
  return { kind: 'agent', agent }
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function agentJob(job: Job) {
  return {
    id: job.id,
    title: job.title,
    scope: job.scope,
    acceptanceCriteria: job.acceptanceCriteria,
    amountSol: job.amountSol,
    reference: job.reference,
    marketplace: ensureMarketplace(job),
    settlement: job.settlement,
    status: job.status,
  }
}

function agentVisibleJobs(auth: AgentAuth) {
  const list = [...jobs.values()]
  if (auth.kind === 'platform') {
    return {
      jobs: list.filter((job) => job.status === 'open').map(agentJob),
      settlements: list.filter((job) => job.settlement.mode === 'devnet-escrow' && !terminal.has(job.status)).map(agentJob),
    }
  }
  const name = auth.agent.name
  return {
    jobs: list
      .filter((job) => job.status === 'open' || job.marketplace?.awardedBid?.by === name)
      .map(agentJob),
    settlements: [],
  }
}

function reviewArtifacts(job: Job): ReviewArtifact[] {
  const run = job.review?.artifactRun
  return run ? [...run.screenshots, ...run.logs] : []
}

async function sendArtifact(res: http.ServerResponse, job: Job, artifactId: string) {
  const artifact = reviewArtifacts(job).find((item) => item.id === artifactId)
  if (!artifact) fail('artifact not found', 404)
  const root = path.resolve(REVIEW_DIR)
  const file = path.resolve(REVIEW_DIR, artifact.file)
  if (!file.startsWith(root + path.sep)) fail('artifact path is invalid', 400)
  res.statusCode = 200
  res.setHeader('Content-Type', artifact.mime)
  res.end(await fs.readFile(file))
}

async function state() {
  const w = await walletsWithBalances()
  const list = [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const hasDevnetEscrow = list.some((job) => job.settlement.mode === 'devnet-escrow')
  const summary = {
    totalJobs: list.length,
    activeJobs: list.filter((job) => !terminal.has(job.status)).length,
    openJobs: list.filter((job) => job.status === 'open').length,
    claimedJobs: list.filter((job) => !terminal.has(job.status) && job.status !== 'open').length,
    inReview: list.filter((job) => job.status === 'submitted' || job.status === 'revision_requested').length,
    releasedJobs: list.filter((job) => job.status === 'released').length,
    disputedJobs: list.filter((job) => job.status === 'disputed').length,
    lockedSol: Number(list
      .filter((job) => !terminal.has(job.status))
      .reduce((sum, job) => sum + Number(job.amountSol || 0), 0)
      .toFixed(6)),
  }
  return {
    jobs: list,
    agents: listConnectedAgents(),
    summary,
    setup: {
      wallets: w,
      mode: hasDevnetEscrow ? 'devnet-escrow' : 'local-demo',
      note: hasDevnetEscrow
        ? 'Agent-awarded jobs use devnet escrow. Manual demo jobs can still use local escrow state.'
        : w.configured
          ? 'Devnet wallets are configured. Manual jobs still use local-demo escrow until an agent awards a job.'
          : 'No local wallets are configured. The platform still runs in local-demo escrow mode.',
    },
  }
}

export function resetJobsForTest(): void {
  resetDemoRun()
  jobs.clear()
  connectedAgents.clear()
}

interface HandlerOptions {
  escrowAdapter?: DevnetEscrowAdapter
  reviewer?: ReviewCompletion
  collectArtifacts?: ArtifactCollector
  demoRunner?: DemoRunner
}

async function runBackendTicks(options: HandlerOptions): Promise<number> {
  return autoReleaseExpiredJobs() + await runAgentMarketTick(options.escrowAdapter)
}

export function createHandler(options: HandlerOptions = {}): http.RequestListener {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (req.method === 'OPTIONS') return send(res, 204, {})

    try {
      const url = new URL(req.url || '/', `http://localhost:${PORT}`)
      const demoRunner = options.demoRunner || localDemoRunner
      const agentRoute = url.pathname.match(/^\/api\/agent\/jobs(?:\/([^/]+)\/(bids|award|delivery|settle))?$/)
      const agentsRoute = url.pathname.match(/^\/api\/agents(?:\/([^/]+)\/(revoke))?$/)
      const route = url.pathname.match(/^\/api\/jobs\/([^/]+)\/(claim|messages|submission|review|dispute|refund|cancel)$/)
      const disputeReviewRoute = url.pathname.match(/^\/api\/jobs\/([^/]+)\/dispute\/review$/)
      const milestoneRoute = url.pathname.match(/^\/api\/jobs\/([^/]+)\/milestones\/([^/]+)\/complete$/)
      const artifactRoute = url.pathname.match(/^\/api\/jobs\/([^/]+)\/artifacts\/([^/]+)$/)

      if (url.pathname === '/api/demo/agent-run') {
        requireLocalRequest(req)
        if (req.method === 'GET') return send(res, 200, sanitizeDemoStatus(await demoRunner.status()))
        if (req.method === 'POST') return send(res, 200, sanitizeDemoStatus(await demoRunner.start(await readJson(req))))
        return send(res, 404, { error: 'not found' })
      }

      if (req.method === 'GET' && url.pathname === '/api/agents') {
        return send(res, 200, { agents: listConnectedAgents() })
      }
      if (req.method === 'POST' && url.pathname === '/api/agents') {
        const created = createConnectedAgent(await readJson(req))
        await saveAgents()
        return send(res, 201, {
          ...created,
          env: [
            'AGENT_TRANSPORT=api',
            `AGENT_API_BASE=http://localhost:${PORT}`,
            `AGENT_API_TOKEN=${created.token}`,
            `AGENT_NAME=${created.agent.name}`,
            created.agent.wallet ? `DEMO_WORKER_WALLET=${created.agent.wallet}` : '',
          ].filter(Boolean).join('\n'),
        })
      }
      if (req.method === 'POST' && agentsRoute?.[1] && agentsRoute[2] === 'revoke') {
        const agent = revokeConnectedAgent(agentsRoute[1])
        await saveAgents()
        return send(res, 200, { agent })
      }

      if (url.pathname.startsWith('/api/agent/')) {
        const auth = requireAgentAuth(req)
        let changed = auth.kind === 'agent' ? 1 : 0
        if (req.method === 'GET' && agentRoute && !agentRoute[1]) {
          changed += await runBackendTicks(options)
          if (changed) {
            await saveJobs()
            await saveAgents()
          }
          return send(res, 200, agentVisibleJobs(auth))
        }
        if (req.method === 'POST' && agentRoute?.[1] && agentRoute[2]) {
          const [, id, action] = agentRoute
          const job = jobs.get(id)
          if (!job) fail('job not found', 404)
          const body = await readJson(req)
          if (action === 'bids') {
            const bid = recordAgentBid(job, auth.kind === 'agent'
              ? { ...body, by: auth.agent.name, wallet: body.wallet || auth.agent.wallet }
              : body)
            await saveJobs()
            if (auth.kind === 'agent') await saveAgents()
            return send(res, 200, { bid, job: agentJob(job) })
          }
          if (action === 'award') {
            if (auth.kind !== 'platform') fail('only the platform can award bids', 403)
            const bid = await awardAgentBid(job, body, options.escrowAdapter)
            await saveJobs()
            return send(res, 200, { bid, job: agentJob(job) })
          }
          if (action === 'delivery') {
            const submission = submitAgentDelivery(job, auth.kind === 'agent' ? { ...body, by: auth.agent.name } : body)
            await assessJobWithAi(job, options.reviewer, options.collectArtifacts)
            await runAgentMarketTick(options.escrowAdapter)
            await saveJobs()
            if (auth.kind === 'agent') await saveAgents()
            return send(res, 200, { submission, job: agentJob(job) })
          }
          if (action === 'settle') {
            if (auth.kind !== 'platform') fail('only the platform can settle escrows', 403)
            const result = await settleAgentEscrow(job, options.escrowAdapter)
            await saveJobs()
            return send(res, 200, { settled: result, job: agentJob(job) })
          }
        }
        return send(res, 404, { error: 'not found' })
      }

      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(res, 200, { ok: true, product: 'freelance-escrow-platform', ...(await state()).setup })
      }
      if (req.method === 'GET' && artifactRoute) {
        const [, id, artifactId] = artifactRoute
        const job = jobs.get(id)
        if (!job) fail('job not found', 404)
        return await sendArtifact(res, job, artifactId)
      }
      if (req.method === 'GET' && (url.pathname === '/api/state' || url.pathname === '/api/platform')) {
        if (await runBackendTicks(options)) await saveJobs()
        return send(res, 200, await state())
      }
      if (req.method === 'GET' && url.pathname === '/api/export') {
        return send(res, 200, { exportedAt: now(), ...(await state()) })
      }
      if (req.method === 'POST' && url.pathname === '/api/import') {
        const body = await readJson(req)
        if (!Array.isArray(body.jobs)) fail('import requires a jobs array')
        const imported = body.jobs.map(hydrateJob).filter((job): job is Job => Boolean(job))
        jobs.clear()
        for (const job of imported) jobs.set(job.id, job)
        await saveJobs()
        return send(res, 200, await state())
      }
      if (req.method === 'POST' && url.pathname === '/api/jobs') {
        createJob(await readJson(req))
        await saveJobs()
        return send(res, 201, await state())
      }
      if (req.method === 'POST' && url.pathname === '/api/demo/seed') {
        jobs.clear()
        const job = createJob({
          title: 'Build a landing page checkout section',
          employer: 'Northstar Studio',
          worker: 'Checkout Guild',
          scope: 'Responsive checkout section with pricing, accessible buttons, deployment notes, and mobile proof.',
          acceptanceCriteria: 'Includes preview URL, repo link, mobile screenshot evidence, pricing copy, and notes for each acceptance item.',
          amountSol: 0.001,
          milestones: [
            'Checkout layout and pricing copy',
            'Accessible buttons and responsive states',
            'Preview URL, repo link, and deployment notes',
          ],
        })
        job.messages.push({ at: now(), author: 'employer', text: 'Please include mobile screenshots and the repo.' })
        addEvent(job, 'system', 'seeded', 'Platform sample job seeded')
        await saveJobs()
        return send(res, 200, await state())
      }
      if (req.method === 'POST' && url.pathname === '/api/state/reset') {
        jobs.clear()
        await saveJobs()
        return send(res, 200, await state())
      }
      if (req.method === 'POST' && milestoneRoute) {
        const [, id, milestoneId] = milestoneRoute
        const job = jobs.get(id)
        if (!job) fail('job not found', 404)
        const body = await readJson(req)
        completeMilestone(job, milestoneId, body.actor === 'employer' ? 'employer' : 'worker')
        await saveJobs()
        return send(res, 200, await state())
      }
      if (req.method === 'POST' && disputeReviewRoute) {
        const [, id] = disputeReviewRoute
        const job = jobs.get(id)
        if (!job) fail('job not found', 404)
        await readJson(req)
        await assessDisputeWithAi(job)
        await saveJobs()
        return send(res, 200, await state())
      }
      if (req.method === 'POST' && route) {
        const [, id, action] = route
        const job = jobs.get(id)
        if (!job) fail('job not found', 404)
        const body = await readJson(req)
        if (action === 'claim') {
          claimJob(job, body)
        } else if (action === 'messages') {
          const author = body.author === 'worker' ? 'worker' : body.author === 'agent' ? 'agent' : 'employer'
          const text = String(body.text || '').trim()
          if (!text) fail('message text is required')
          if (job.status === 'open' && author !== 'employer') fail('cannot message as worker before task is claimed', 409)
          job.messages.push({ at: now(), author, text })
          addEvent(job, author, 'message', text.slice(0, 80))
        } else if (action === 'submission') {
          submitJob(job, body)
        } else if (action === 'review') {
          if (!body.action) {
            reviewJob(job)
          } else if (body.action === 'assess') {
            await assessJobWithAi(job)
          } else if (body.action === 'assess_dispute') {
            await assessDisputeWithAi(job)
          } else if (body.action === 'approve') {
            approveReviewedJob(job, body)
          } else if (body.action === 'request_revision') {
            requestRevisionJob(job, body)
          } else {
            fail('unknown review action')
          }
        } else if (action === 'dispute') {
          disputeJob(job, body)
        } else if (action === 'refund') {
          refundJob(job)
        } else if (action === 'cancel') {
          cancelJob(job)
        }
        await saveJobs()
        return send(res, 200, await state())
      }
      send(res, 404, { error: 'not found' })
    } catch (e) {
      send(res, (e as { status?: number }).status || 500, { error: (e as Error).message })
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await loadEnv()
  await loadJobs()
  await loadAgents()
  let tickRunning = false
  setInterval(async () => {
    if (tickRunning) return
    tickRunning = true
    try {
      if (await runBackendTicks({})) await saveJobs()
    } catch (e) {
      console.error(`[freelance-escrow] market tick: ${(e as Error).message}`)
    } finally {
      tickRunning = false
    }
  }, 5000).unref()
  http.createServer(createHandler()).listen(PORT, () => {
    console.error(`[freelance-escrow] API on http://localhost:${PORT}`)
  })
}
