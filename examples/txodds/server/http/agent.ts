import type http from 'node:http'
import { connectedAgents, hashToken, jobs, saveAgents } from '../store.js'
import type { AgentAuth, Job } from '../types.js'
import { ensureMarketplace, pendingPanelReviewJob } from '../domain/index.js'
import { fail, now, terminal } from '../domain/utils.js'

export async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
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

export function requireLocalRequest(req: http.IncomingMessage): void {
  const address = req.socket.remoteAddress || ''
  const local = address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1'
    || address.startsWith('::ffff:127.')
  if (!local) fail('demo runner is local only', 403)
}

export function requireAgentAuth(req: http.IncomingMessage): AgentAuth {
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

export function send(res: http.ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export function agentJob(job: Job) {
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

export function agentVisibleJobs(auth: AgentAuth) {
  const list = [...jobs.values()]
  if (auth.kind === 'platform') {
    return {
      jobs: list.filter((job) => job.status === 'open').map(agentJob),
      reviews: list.filter(pendingPanelReviewJob).map(agentJob),
      settlements: list.filter((job) => job.settlement.mode === 'devnet-escrow' && !terminal.has(job.status)).map(agentJob),
    }
  }
  const name = auth.agent.name
  return {
    jobs: list
      .filter((job) => job.status === 'open' || job.marketplace?.awardedBid?.by === name)
      .map(agentJob),
    reviews: [],
    settlements: [],
  }
}
