import http from 'node:http'
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import bs58 from 'bs58'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { complete, parseJsonReply } from '../../../packages/agent-runtime/src/llm/complete.ts'

const ENV_PATH = process.env.KIT_ENV ?? fileURLToPath(new URL('../../../.env', import.meta.url))
const DATA_DIR = fileURLToPath(new URL('../.data/', import.meta.url))
const DATA_FILE = `${DATA_DIR}jobs.json`
const REVIEW_DIR = `${DATA_DIR}reviews`
const PORT = Number(process.env.PORT ?? 8801)
const DEFAULT_RPC_URL = 'https://api.devnet.solana.com'
const BALANCE_TIMEOUT_MS = 2500
const REVIEW_TIMEOUT_MS = Number(process.env.REVIEW_TIMEOUT_MS ?? 90000)
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
}
interface Milestone { id: string; title: string; description: string; amountSol: number; status: MilestoneStatus; completedAt?: string }
interface Dispute { at: string; by: Exclude<Actor, 'system' | 'agent'>; note: string; status: 'open' }
interface SettlementEvent { at: string; type: SettlementEventType; summary: string }
interface Settlement {
  mode: 'local-demo'
  escrow: string
  release?: string
  refund?: string
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
  settlement: Settlement
  events: Event[]
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

function keypair(key: string): Keypair | null {
  const raw = process.env[key]?.trim()
  if (!raw) return null
  try { return Keypair.fromSecretKey(bs58.decode(raw)) } catch { return null }
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
    disputes: Array.isArray(source.disputes) ? source.disputes : [],
    settlement: {
      mode: 'local-demo',
      escrow: source.settlement?.escrow || `local-${reference.slice(0, 12)}`,
      ...(source.settlement?.release ? { release: source.settlement.release } : {}),
      ...(source.settlement?.refund ? { refund: source.settlement.refund } : {}),
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

function releaseGateProblems(job: Job, review: Review): string[] {
  const criteria = review.criteriaResults.length ? review.criteriaResults : review.checks
  return [
    ...(review.recommendation !== 'approve' ? ['AI did not recommend release'] : []),
    ...(review.score < 80 ? ['Review score is below 80'] : []),
    ...(!criteria.length ? ['Acceptance criteria were not checked'] : criteria.filter((check) => check.status !== 'pass').map((check) => `${check.label} is ${check.status}`)),
    ...review.missing,
    ...review.criticalRisks,
    ...artifactGateProblems(job, review.artifactRun),
    ...(job.disputes.some((dispute) => dispute.status === 'open') ? ['An active dispute blocks release'] : []),
  ].filter(Boolean).slice(0, 12)
}

function finalizeReviewGates(job: Job, review: Review): Review {
  const problems = releaseGateProblems(job, review)
  const missing = [...new Set([...review.missing, ...problems])]
  return {
    ...review,
    missing: missing.slice(0, 12),
    releaseEligible: problems.length === 0,
    approved: problems.length === 0,
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

function reviewPrompt(job: Job, artifactRun?: ArtifactRun): string {
  return JSON.stringify({
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
      activity: job.events.slice(0, 20).reverse(),
    },
    artifactRun,
    releasePolicy: {
      minimumScore: 80,
      requireEveryCriterionPass: true,
      requireNoCriticalRisks: true,
      requireScreenshotsForVisualWork: visualReviewRequired(job),
      finalReleaseBy: 'employer',
    },
  }, null, 2)
}

function normalizeAiReview(job: Job, artifactRun: ArtifactRun, reply: AiReviewReply | null): Review | null {
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
  return finalizeReviewGates(job, review)
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

export async function assessJobWithAi(job: Job, reviewer: ReviewCompletion = complete, collectArtifacts: ArtifactCollector = collectReviewArtifacts): Promise<Review> {
  ensureStatus(job, ['submitted', 'revision_requested'], 'review')
  if (!job.submission) fail('worker submission is required')
  let review: Review
  let artifactRun: ArtifactRun | undefined
  try {
    artifactRun = await collectArtifacts(job)
    review = normalizeAiReview(job, artifactRun, parseJsonReply<AiReviewReply>(await reviewer({
      system: REVIEW_SYSTEM,
      user: reviewPrompt(job, artifactRun),
      maxTokens: 2000,
    }))) ?? finalizeReviewGates(job, fallbackReview('AI review returned an unreadable assessment; request clearer evidence or retry.', artifactRun))
  } catch {
    review = finalizeReviewGates(job, fallbackReview('Artifact or AI review failed; request clearer evidence or retry assessment.', artifactRun))
  }
  job.review = review
  addEvent(job, 'agent', 'ai_reviewed', review.summary)
  addSettlementEvent(job, 'reviewed', review.releaseEligible ? 'Artifact review passed; employer release is enabled' : 'Artifact review requested clearer delivery evidence')
  return review
}

export function approveReviewedJob(job: Job, input: Record<string, unknown> = {}): Review {
  ensureStatus(job, ['submitted', 'revision_requested'], 'approve')
  if (!job.submission) fail('worker submission is required')
  if (!job.review) fail('AI review is required before release', 409)
  if (!job.review.releaseEligible) fail('review gates do not allow release', 409)
  job.review = { ...job.review, approved: true, recommendation: 'approve' }
  job.status = 'released'
  job.settlement.release = `demo-release-${job.reference.slice(0, 10)}`
  job.milestones = job.milestones.map((m) => ({ ...m, status: 'complete', completedAt: m.completedAt || now() }))
  addSettlementEvent(job, 'released', `Employer released ${job.amountSol} SOL to ${job.worker}`)
  addEvent(job, 'employer', 'released', 'Employer approved delivery after AI review')
  return job.review
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

export function disputeJob(job: Job, input: Record<string, unknown>): Dispute {
  ensureStatus(job, ['funded', 'submitted', 'approved', 'revision_requested', 'disputed'], 'dispute')
  const by: Dispute['by'] = input.by === 'worker' ? 'worker' : 'employer'
  const dispute = {
    at: now(),
    by,
    note: String(input.note || 'Dispute opened for manual review').trim(),
    status: 'open' as const,
  }
  job.disputes.unshift(dispute)
  job.status = 'disputed'
  addEvent(job, dispute.by, 'disputed', dispute.note)
  addSettlementEvent(job, 'disputed', dispute.note)
  return dispute
}

export function refundJob(job: Job): void {
  ensureStatus(job, ['funded', 'submitted', 'revision_requested', 'disputed'], 'refund')
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

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
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
    summary,
    setup: {
      wallets: w,
      mode: 'local-demo',
      note: w.configured
        ? 'Devnet wallets are configured. The platform models escrow locally until direct program settlement is wired.'
        : 'No local wallets are configured. The platform still runs in local-demo escrow mode.',
    },
  }
}

export function resetJobsForTest(): void {
  jobs.clear()
}

export function createHandler(): http.RequestListener {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') return send(res, 204, {})

    try {
      const url = new URL(req.url || '/', `http://localhost:${PORT}`)
      const route = url.pathname.match(/^\/api\/jobs\/([^/]+)\/(claim|messages|submission|review|dispute|refund|cancel)$/)
      const milestoneRoute = url.pathname.match(/^\/api\/jobs\/([^/]+)\/milestones\/([^/]+)\/complete$/)
      const artifactRoute = url.pathname.match(/^\/api\/jobs\/([^/]+)\/artifacts\/([^/]+)$/)

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
  http.createServer(createHandler()).listen(PORT, () => {
    console.error(`[freelance-escrow] API on http://localhost:${PORT}`)
  })
}
