import path from 'node:path'
import { spawn } from 'node:child_process'
import { DEMO_MAX_WORKERS, DEMO_SESSION_TTL_MS, INTERNAL_API_BASE, ROOT_DIR, publicUrl } from '../config.js'
import {
  connectedAgents,
  createConnectedAgent,
  demoAgentBase,
  demoRunState,
  demoRunStates,
  demoSessions,
  jobs,
  mcpDemoAgentBase,
  mcpDemoState,
  mcpDemoStates,
  saveAgents,
  saveJobs,
  type DemoRunState,
  type McpDemoState,
} from '../store.js'
import { createJob } from '../domain/index.js'
import type { ConnectedAgent, DemoRunStatus, Job, McpDemoStatus, DemoRunner } from '../types.js'
import { addEvent, fail, now, publicKey, wallets } from '../domain/utils.js'

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function demoRunForSession(sessionId?: string): DemoRunState {
  if (!sessionId) return demoRunState
  let state = demoRunStates.get(sessionId)
  if (!state) {
    state = { logs: [] }
    demoRunStates.set(sessionId, state)
  }
  return state
}

function mcpStateForSession(sessionId?: string): McpDemoState {
  if (!sessionId) return mcpDemoState
  let state = mcpDemoStates.get(sessionId)
  if (!state) {
    state = {}
    mcpDemoStates.set(sessionId, state)
  }
  return state
}

function activeWorkerCount(except?: DemoRunState): number {
  const states = [demoRunState, ...demoRunStates.values()]
  return states.filter((state) =>
    state !== except
    && state.child
    && state.child.exitCode === null
    && !state.child.killed
  ).length
}

export function touchDemoSession(sessionId: string): void {
  cleanupDemoSessions()
  demoSessions.set(sessionId, { lastSeen: Date.now() })
}

export function cleanupDemoSessions(nowMs = Date.now()): void {
  if (!Number.isFinite(DEMO_SESSION_TTL_MS) || DEMO_SESSION_TTL_MS <= 0) return
  for (const [sessionId, session] of demoSessions) {
    if (nowMs - session.lastSeen <= DEMO_SESSION_TTL_MS) continue
    resetDemoRun(sessionId)
    resetMcpDemoSession(sessionId)
    for (const [jobId, job] of jobs) {
      if (job.demoSessionId === sessionId) jobs.delete(jobId)
    }
    demoRunStates.delete(sessionId)
    mcpDemoStates.delete(sessionId)
    demoSessions.delete(sessionId)
  }
}

export function demoSessionJobs(sessionId?: string): Job[] {
  return [...jobs.values()].filter((job) => !sessionId || job.demoSessionId === sessionId)
}

function hasDemoSessionState(sessionId: string): boolean {
  return demoSessionJobs(sessionId).length > 0
    || [...connectedAgents.values()].some((agent) => agent.demoSessionId === sessionId && agent.status === 'active')
}

export function recoverDemoSessionId(existing?: string): string | undefined {
  cleanupDemoSessions()
  if (existing && hasDemoSessionState(existing)) return existing

  const scores = new Map<string, number>()
  for (const job of jobs.values()) {
    if (!job.demoSessionId || ['released', 'refunded', 'cancelled'].includes(job.status)) continue
    scores.set(job.demoSessionId, Math.max(scores.get(job.demoSessionId) || 0, new Date(job.createdAt).getTime()))
  }
  for (const agent of connectedAgents.values()) {
    if (!agent.demoSessionId || agent.status !== 'active') continue
    scores.set(agent.demoSessionId, Math.max(scores.get(agent.demoSessionId) || 0, new Date(agent.lastSeenAt || agent.createdAt).getTime()))
  }

  return [...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

function demoSteps(state: DemoRunState, job?: Job): DemoRunStatus['steps'] {
  const market = job?.marketplace
  return {
    agentStarted: Boolean(state.child && state.child.exitCode === null && !state.child.killed),
    jobPosted: Boolean(job),
    bidPlaced: Boolean(market?.bids?.length),
    awarded: Boolean(market?.awardedBid),
    funded: job?.settlement.mode === 'devnet-escrow',
    buildServed: Boolean(state.previewUrl || job?.submission?.url),
    deliverySubmitted: Boolean(job?.submission),
    reviewCaptured: Boolean(job?.review),
  }
}

function cleanDemoText(value: unknown): string {
  return String(value ?? '')
    .replace(/agt_[A-Za-z0-9_-]+/g, 'agt_[redacted]')
    .replace(/AGENT_API_TOKEN=\S+/g, 'AGENT_API_TOKEN=[redacted]')
}

function appendDemoLog(state: DemoRunState, value: unknown): void {
  for (const line of cleanDemoText(value).split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const preview = line.match(/serving generated delivery at\s+(https?:\/\/\S+)/i)?.[1]
    if (preview) state.previewUrl = preview
    state.logs.push(line)
  }
  state.logs = state.logs.slice(-40)
}

function demoJob(state: DemoRunState): Job | undefined {
  return state.jobId ? jobs.get(state.jobId) : undefined
}

export function demoStatus(sessionId?: string): DemoRunStatus {
  const state = demoRunForSession(sessionId)
  const job = demoJob(state)
  const running = Boolean(state.child && state.child.exitCode === null && !state.child.killed)
  const previewUrl = job?.submission?.url || state.previewUrl
  const error = state.error || job?.marketplace?.awardError
  return {
    running,
    agentName: state.agentName || demoAgentBase,
    ...(running && state.child?.pid ? { pid: state.child.pid } : {}),
    ...(state.jobId ? { jobId: state.jobId } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(state.startedAt ? { startedAt: state.startedAt } : {}),
    ...(error ? { error: cleanDemoText(error) } : {}),
    logs: state.logs.map(cleanDemoText),
    steps: demoSteps(state, job),
  }
}

export function sanitizeDemoStatus(input: DemoRunStatus | Record<string, unknown>): DemoRunStatus {
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

export function resetDemoRun(sessionId?: string): void {
  const state = demoRunForSession(sessionId)
  if (state.child && state.child.exitCode === null && !state.child.killed) {
    state.child.kill()
  }
  for (const agent of connectedAgents.values()) {
    const sameSession = sessionId ? agent.demoSessionId === sessionId : agent.name === state.agentName
    if (sameSession && agent.status === 'active') agent.status = 'revoked'
  }
  state.child = undefined
  state.agentName = undefined
  state.token = undefined
  state.jobId = undefined
  state.previewUrl = undefined
  state.startedAt = undefined
  state.error = undefined
  state.logs = []
}

export function cleanDemoState(sessionId?: string): void {
  resetDemoRun(sessionId)
  resetMcpDemoSession(sessionId)
  if (sessionId) {
    for (const [jobId, job] of jobs) {
      if (job.demoSessionId === sessionId) jobs.delete(jobId)
    }
  } else {
    jobs.clear()
  }
}

function demoAgentName(): string {
  if (![...connectedAgents.values()].some((agent) => agent.status === 'active' && agent.name === demoAgentBase)) {
    return demoAgentBase
  }
  return `${demoAgentBase}-${Date.now().toString(36)}`
}

function demoJobDetails(input: Record<string, unknown> = {}) {
  return {
    title: String(input.title || 'Build a live agent checkout page').trim() || 'Build a live agent checkout page',
    employer: String(input.employer || 'Northstar Studio').trim() || 'Northstar Studio',
    scope: String(input.scope || 'Generate and serve a responsive checkout mini-site with pricing copy, mobile proof, and delivery notes.').trim(),
    acceptanceCriteria: String(input.acceptanceCriteria || 'Includes a public preview URL or buildable repository artifact; generated checkout hero; pricing proof; mobile responsive layout; delivery notes for every acceptance item.').trim(),
    amountSol: Number(input.amountSol || input.budgetSol || 0.003) || 0.003,
  }
}

export function createDemoRunJob(input: Record<string, unknown> = {}, sessionId?: string): Job {
  const details = demoJobDetails(input)
  const job = createJob({
    title: details.title,
    employer: details.employer,
    marketplace: true,
    scope: details.scope,
    acceptanceCriteria: details.acceptanceCriteria,
    amountSol: details.amountSol,
    milestones: [
      'Generate checkout mini-site',
      'Build reviewable artifact',
      'Submit public preview URL or repo plus delivery notes',
    ],
  })
  if (sessionId) job.demoSessionId = sessionId
  if (job.marketplace) {
    const fastBidWindow = Number(process.env.DEMO_RUN_BID_WINDOW_MS ?? 3000)
    job.marketplace.bidWindowEndsAt = new Date(Date.now() + (Number.isFinite(fastBidWindow) ? fastBidWindow : 3000)).toISOString()
  }
  job.messages.push({ at: now(), author: 'employer', text: 'Demo run: worker agent should generate and submit reviewable evidence. A public preview URL is useful but a buildable repo with notes is acceptable.' })
  addEvent(job, 'system', 'demo_run', 'One-click live agent demo started')
  return job
}

async function startLocalDemoRun(input: Record<string, unknown> = {}, sessionId?: string): Promise<DemoRunStatus> {
  const state = demoRunForSession(sessionId)
  if (input.stop) {
    resetDemoRun(sessionId)
    return demoStatus(sessionId)
  }
  const restart = Boolean(input.restart)
  const running = Boolean(state.child && state.child.exitCode === null && !state.child.killed)
  if (running && !restart) return demoStatus(sessionId)
  if (running && restart) resetDemoRun(sessionId)
  if (!running && DEMO_MAX_WORKERS > 0 && activeWorkerCount(state) >= DEMO_MAX_WORKERS) {
    fail('demo worker capacity is full; try again shortly', 429)
  }

  const workerWallet = wallets().worker
  if (!publicKey(workerWallet)) fail('SELLER_KEYPAIR_B58 or WALLET is required before running the live agent demo', 503)

  const created = createConnectedAgent({ name: demoAgentName(), wallet: workerWallet, ...(sessionId ? { demoSessionId: sessionId } : {}) })
  const requestedJobId = String(input.jobId || '').trim()
  const job = requestedJobId ? jobs.get(requestedJobId) : createDemoRunJob(input, sessionId)
  if (!job) fail('job not found', 404)
  if (sessionId && job.demoSessionId !== sessionId) fail('job not found', 404)
  if (!job.marketplace || job.status !== 'open') fail('demo worker job must be an open marketplace task', 409)
  if (requestedJobId) {
    const fastBidWindow = Number(process.env.DEMO_RUN_BID_WINDOW_MS ?? 3000)
    job.marketplace.bidWindowEndsAt = new Date(Date.now() + (Number.isFinite(fastBidWindow) ? fastBidWindow : 3000)).toISOString()
    job.messages.push({ at: now(), author: 'employer', text: 'Demo run: bundled worker should bid, build, and submit Coral panel delivery evidence.' })
    addEvent(job, 'system', 'demo_run', 'Bundled worker demo started for existing task')
  }
  await saveAgents()
  await saveJobs()

  state.agentName = created.agent.name
  state.token = created.token
  state.jobId = job.id
  state.previewUrl = undefined
  state.startedAt = now()
  state.error = undefined
  state.logs = []

  const env = {
    ...process.env,
    AGENT_TRANSPORT: 'api',
    AGENT_API_BASE: INTERNAL_API_BASE,
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
    DEMO_TARGET_JOB_ID: job.id,
    DEMO_REVIEW_MODE: String(input.reviewMode || 'coral-panel'),
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
    state.error = message
    appendDemoLog(state, `[demo-run] worker error: ${message}`)
    return demoStatus(sessionId)
  }
  state.child = child
  appendDemoLog(state, `[demo-run] started ${created.agent.name} for ${job.id}`)
  child.stdout?.on('data', (chunk) => appendDemoLog(state, chunk))
  child.stderr?.on('data', (chunk) => appendDemoLog(state, chunk))
  child.on('error', (error) => {
    state.error = error.message
    appendDemoLog(state, `[demo-run] worker error: ${error.message}`)
  })
  child.on('exit', (code) => {
    if (code && !state.error) state.error = `worker exited with code ${code}`
    appendDemoLog(state, `[demo-run] worker exited with code ${code ?? 'unknown'}`)
  })
  return demoStatus(sessionId)
}

export function localDemoRunnerForSession(sessionId?: string): DemoRunner {
  return {
    start(input) {
      return startLocalDemoRun(input, sessionId)
    },
    async status() {
      return demoStatus(sessionId)
    },
  }
}

export const localDemoRunner: DemoRunner = localDemoRunnerForSession()

export function resetMcpDemoSession(sessionId?: string): void {
  const state = mcpStateForSession(sessionId)
  if (state.agentId) {
    const agent = connectedAgents.get(state.agentId)
    if (agent) agent.status = 'revoked'
  }
  state.agentId = undefined
  state.agentName = undefined
  state.token = undefined
  state.jobId = undefined
  state.startedAt = undefined
}

function mcpDemoAgentName(): string {
  if (![...connectedAgents.values()].some((agent) => agent.status === 'active' && agent.name === mcpDemoAgentBase)) {
    return mcpDemoAgentBase
  }
  return `${mcpDemoAgentBase}-${Date.now().toString(36)}`
}

function mcpDemoAgent(state: McpDemoState): ConnectedAgent | undefined {
  return state.agentId ? connectedAgents.get(state.agentId) : undefined
}

function mcpDemoJob(state: McpDemoState): Job | undefined {
  return state.jobId ? jobs.get(state.jobId) : undefined
}

function mcpDemoUrl(): string {
  return publicUrl('/mcp')
}

function mcpDemoSteps(agent?: ConnectedAgent, job?: Job): McpDemoStatus['steps'] {
  const market = job?.marketplace
  return {
    registered: Boolean(agent),
    jobPosted: Boolean(job),
    connected: Boolean(agent?.lastSeenAt),
    bidPlaced: Boolean(market?.bids?.length),
    awarded: Boolean(market?.awardedBid),
    funded: job?.settlement.mode === 'devnet-escrow',
    deliverySubmitted: Boolean(job?.submission),
    reviewCaptured: Boolean(job?.review),
  }
}

export function mcpDemoStatus(includeSecret = false, sessionId?: string): McpDemoStatus {
  const state = mcpStateForSession(sessionId)
  const agent = mcpDemoAgent(state)
  const job = mcpDemoJob(state)
  const previewUrl = job?.submission?.url
  const token = includeSecret ? state.token : undefined
  const authorizationHeader = token ? `Authorization: Bearer ${token}` : undefined
  const setup = token ? [
    `MCP_URL=${mcpDemoUrl()}`,
    `MCP_AUTH_HEADER=${authorizationHeader}`,
    `MCP_JOB_ID=${state.jobId || ''}`,
  ].join('\n') : undefined
  return {
    active: Boolean(agent || job),
    agentName: agent?.name || state.agentName || mcpDemoAgentBase,
    mcpUrl: mcpDemoUrl(),
    ...(state.jobId ? { jobId: state.jobId } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(state.startedAt ? { startedAt: state.startedAt } : {}),
    ...(agent?.lastSeenAt ? { lastSeenAt: agent.lastSeenAt } : {}),
    ...(authorizationHeader ? { authorizationHeader } : {}),
    ...(setup ? { setup } : {}),
    ...(token ? { token } : {}),
    ...(job?.marketplace?.awardError ? { error: cleanDemoText(job.marketplace.awardError) } : {}),
    events: (job?.events || []).slice(0, 8).map((event) => `${event.type}: ${event.summary}`),
    steps: mcpDemoSteps(agent, job),
  }
}

export async function startMcpDemoSession(input: Record<string, unknown> = {}, sessionId?: string): Promise<McpDemoStatus> {
  const state = mcpStateForSession(sessionId)
  if (input.resetOnly) {
    resetMcpDemoSession(sessionId)
    await saveAgents()
    return mcpDemoStatus(false, sessionId)
  }
  if (input.restart) resetMcpDemoSession(sessionId)
  const requestedJobId = String(input.jobId || '').trim()
  if (requestedJobId && state.jobId !== requestedJobId) resetMcpDemoSession(sessionId)
  if (state.token && state.jobId && mcpDemoAgent(state)?.status === 'active') {
    return mcpDemoStatus(true, sessionId)
  }

  const wallet = String(input.wallet || wallets().worker || '').trim()
  if (wallet && !publicKey(wallet)) fail('valid payout wallet is required')
  const created = createConnectedAgent({ name: mcpDemoAgentName(), wallet, ...(sessionId ? { demoSessionId: sessionId } : {}) })
  const job = requestedJobId ? jobs.get(requestedJobId) : createDemoRunJob(input, sessionId)
  if (!job) fail('job not found', 404)
  if (sessionId && job.demoSessionId !== sessionId) fail('job not found', 404)
  if (!job.marketplace || job.status !== 'open') fail('MCP demo job must be an open marketplace task', 409)
  job.messages.push({ at: now(), author: 'employer', text: 'MCP demo: connect OpenClaw to the platform MCP server, bid, build, and submit delivery evidence.' })
  addEvent(job, 'system', 'mcp_demo', 'MCP worker-agent demo session created')
  state.agentId = created.agent.id
  state.agentName = created.agent.name
  state.token = created.token
  state.jobId = job.id
  state.startedAt = now()
  await saveAgents()
  await saveJobs()
  return mcpDemoStatus(true, sessionId)
}
