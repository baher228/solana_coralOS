import fs from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { AGENTS_FILE, DATA_DIR, DATA_FILE } from './config.js'
import type { ConnectedAgent, DemoRunStatus, DevnetEscrow, Dispute, Job, MarketplaceBid, MarketplaceState, Milestone, Status } from './types.js'
import { deadlineFromNowSecs, fail, makeMilestones, now, participantName, publicKey, referenceFor, statuses, wallets } from './domain/utils.js'

export interface McpDemoState {
  agentId?: string
  agentName?: string
  token?: string
  jobId?: string
  startedAt?: string
}

export interface DemoRunState {
  child?: ChildProcess
  agentName?: string
  token?: string
  jobId?: string
  previewUrl?: string
  startedAt?: string
  error?: string
  logs: string[]
}

export const jobs = new Map<string, Job>()
export const connectedAgents = new Map<string, ConnectedAgent>()
export const demoAgentBase = 'demo-worker-live'
export const mcpDemoAgentBase = 'openclaw-mcp-demo'
export const mcpDemoState: McpDemoState = {}
export const demoRunState: DemoRunState = { logs: [] }
export const demoSessions = new Map<string, { lastSeen: number }>()
export const demoRunStates = new Map<string, DemoRunState>()
export const mcpDemoStates = new Map<string, McpDemoState>()

export function resetStoresForTest(): void {
  jobs.clear()
  connectedAgents.clear()
  demoSessions.clear()
  demoRunStates.clear()
  mcpDemoStates.clear()
  Object.keys(mcpDemoState).forEach((key) => delete mcpDemoState[key as keyof typeof mcpDemoState])
  demoRunState.child = undefined
  demoRunState.agentName = undefined
  demoRunState.token = undefined
  demoRunState.jobId = undefined
  demoRunState.previewUrl = undefined
  demoRunState.startedAt = undefined
  demoRunState.error = undefined
  demoRunState.logs = []
}

export async function loadJobs(): Promise<void> {
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

export async function saveJobs(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(DATA_FILE, JSON.stringify([...jobs.values()], null, 2))
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function sanitizeAgent(agent: ConnectedAgent) {
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
    ...(source.demoSessionId ? { demoSessionId: String(source.demoSessionId) } : {}),
    tokenHash,
    status: source.status === 'revoked' ? 'revoked' : 'active',
    createdAt: String(source.createdAt || now()),
    ...(source.lastSeenAt ? { lastSeenAt: String(source.lastSeenAt) } : {}),
  }
}

export async function loadAgents(): Promise<void> {
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

export async function saveAgents(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(AGENTS_FILE, JSON.stringify([...connectedAgents.values()], null, 2))
}

export function listConnectedAgents(demoSessionId?: string) {
  return [...connectedAgents.values()]
    .filter((agent) => !demoSessionId || agent.demoSessionId === demoSessionId)
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
    ...(input.demoSessionId ? { demoSessionId: String(input.demoSessionId) } : {}),
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

export function hydrateJob(input: unknown): Job | null {
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
    ...(source.demoSessionId ? { demoSessionId: String(source.demoSessionId) } : {}),
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
