import path from 'node:path'
import { spawn } from 'node:child_process'
import { PORT, ROOT_DIR } from '../config.js'
import { connectedAgents, createConnectedAgent, demoAgentBase, demoRunState, jobs, mcpDemoAgentBase, mcpDemoState, saveAgents, saveJobs } from '../store.js'
import { createJob } from '../domain/index.js'
import type { ConnectedAgent, DemoRunStatus, Job, McpDemoStatus, DemoRunner } from '../types.js'
import { addEvent, fail, now, publicKey, wallets } from '../domain/utils.js'

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

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

export function demoStatus(): DemoRunStatus {
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

export function resetDemoRun(): void {
  if (demoRunState.child && demoRunState.child.exitCode === null && !demoRunState.child.killed) {
    demoRunState.child.kill()
  }
  if (demoRunState.agentName) {
    for (const agent of connectedAgents.values()) {
      if (agent.name === demoRunState.agentName && agent.status === 'active') agent.status = 'revoked'
    }
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

export function cleanDemoState(): void {
  resetDemoRun()
  resetMcpDemoSession()
  jobs.clear()
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
    acceptanceCriteria: String(input.acceptanceCriteria || 'Includes a clickable preview URL; generated checkout hero; pricing proof; mobile responsive layout; delivery notes for every acceptance item.').trim(),
    amountSol: Number(input.amountSol || input.budgetSol || 0.003) || 0.003,
  }
}

function createDemoRunJob(input: Record<string, unknown> = {}): Job {
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
  if (input.stop) {
    resetDemoRun()
    return demoStatus()
  }
  const restart = Boolean(input.restart)
  const running = Boolean(demoRunState.child && demoRunState.child.exitCode === null && !demoRunState.child.killed)
  if (running && !restart) return demoStatus()
  if (running && restart) resetDemoRun()

  const workerWallet = wallets().worker
  if (!publicKey(workerWallet)) fail('SELLER_KEYPAIR_B58 or WALLET is required before running the live agent demo', 503)

  const created = createConnectedAgent({ name: demoAgentName(), wallet: workerWallet })
  const requestedJobId = String(input.jobId || '').trim()
  const job = requestedJobId ? jobs.get(requestedJobId) : createDemoRunJob(input)
  if (!job) fail('job not found', 404)
  if (!job.marketplace || job.status !== 'open') fail('demo worker job must be an open marketplace task', 409)
  if (requestedJobId) {
    const fastBidWindow = Number(process.env.DEMO_RUN_BID_WINDOW_MS ?? 3000)
    job.marketplace.bidWindowEndsAt = new Date(Date.now() + (Number.isFinite(fastBidWindow) ? fastBidWindow : 3000)).toISOString()
    job.messages.push({ at: now(), author: 'employer', text: 'Demo run: bundled worker should bid, build, and submit Coral panel delivery evidence.' })
    addEvent(job, 'system', 'demo_run', 'Bundled worker demo started for existing task')
  }
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

export const localDemoRunner: DemoRunner = {
  start: startLocalDemoRun,
  async status() {
    return demoStatus()
  },
}

export function resetMcpDemoSession(): void {
  if (mcpDemoState.agentId) {
    const agent = connectedAgents.get(mcpDemoState.agentId)
    if (agent) agent.status = 'revoked'
  }
  mcpDemoState.agentId = undefined
  mcpDemoState.agentName = undefined
  mcpDemoState.token = undefined
  mcpDemoState.jobId = undefined
  mcpDemoState.startedAt = undefined
}

function mcpDemoAgentName(): string {
  if (![...connectedAgents.values()].some((agent) => agent.status === 'active' && agent.name === mcpDemoAgentBase)) {
    return mcpDemoAgentBase
  }
  return `${mcpDemoAgentBase}-${Date.now().toString(36)}`
}

function mcpDemoAgent(): ConnectedAgent | undefined {
  return mcpDemoState.agentId ? connectedAgents.get(mcpDemoState.agentId) : undefined
}

function mcpDemoJob(): Job | undefined {
  return mcpDemoState.jobId ? jobs.get(mcpDemoState.jobId) : undefined
}

function mcpDemoUrl(): string {
  return `http://localhost:${PORT}/mcp`
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

export function mcpDemoStatus(includeSecret = false): McpDemoStatus {
  const agent = mcpDemoAgent()
  const job = mcpDemoJob()
  const previewUrl = job?.submission?.url
  const token = includeSecret ? mcpDemoState.token : undefined
  const authorizationHeader = token ? `Authorization: Bearer ${token}` : undefined
  const setup = token ? [
    `MCP_URL=${mcpDemoUrl()}`,
    `MCP_AUTH_HEADER=${authorizationHeader}`,
    `MCP_JOB_ID=${mcpDemoState.jobId || ''}`,
  ].join('\n') : undefined
  return {
    active: Boolean(agent || job),
    agentName: agent?.name || mcpDemoState.agentName || mcpDemoAgentBase,
    mcpUrl: mcpDemoUrl(),
    ...(mcpDemoState.jobId ? { jobId: mcpDemoState.jobId } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(mcpDemoState.startedAt ? { startedAt: mcpDemoState.startedAt } : {}),
    ...(agent?.lastSeenAt ? { lastSeenAt: agent.lastSeenAt } : {}),
    ...(authorizationHeader ? { authorizationHeader } : {}),
    ...(setup ? { setup } : {}),
    ...(token ? { token } : {}),
    ...(job?.marketplace?.awardError ? { error: cleanDemoText(job.marketplace.awardError) } : {}),
    events: (job?.events || []).slice(0, 8).map((event) => `${event.type}: ${event.summary}`),
    steps: mcpDemoSteps(agent, job),
  }
}

export async function startMcpDemoSession(input: Record<string, unknown> = {}): Promise<McpDemoStatus> {
  if (input.resetOnly) {
    resetMcpDemoSession()
    await saveAgents()
    return mcpDemoStatus(false)
  }
  if (input.restart) resetMcpDemoSession()
  const requestedJobId = String(input.jobId || '').trim()
  if (requestedJobId && mcpDemoState.jobId !== requestedJobId) resetMcpDemoSession()
  if (mcpDemoState.token && mcpDemoState.jobId && mcpDemoAgent()?.status === 'active') {
    return mcpDemoStatus(true)
  }

  const wallet = String(input.wallet || wallets().worker || '').trim()
  if (wallet && !publicKey(wallet)) fail('valid payout wallet is required')
  const created = createConnectedAgent({ name: mcpDemoAgentName(), wallet })
  const job = requestedJobId ? jobs.get(requestedJobId) : createDemoRunJob(input)
  if (!job) fail('job not found', 404)
  if (!job.marketplace || job.status !== 'open') fail('MCP demo job must be an open marketplace task', 409)
  job.messages.push({ at: now(), author: 'employer', text: 'MCP demo: connect OpenClaw to the platform MCP server, bid, build, and submit delivery evidence.' })
  addEvent(job, 'system', 'mcp_demo', 'MCP worker-agent demo session created')
  mcpDemoState.agentId = created.agent.id
  mcpDemoState.agentName = created.agent.name
  mcpDemoState.token = created.token
  mcpDemoState.jobId = job.id
  mcpDemoState.startedAt = now()
  await saveAgents()
  await saveJobs()
  return mcpDemoStatus(true)
}
