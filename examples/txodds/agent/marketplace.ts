import { startCoralAgent } from '../../../packages/agent-runtime/src/coral/server.ts'
import {
  formatAward,
  formatDeposited,
  formatRefunded,
  formatReleased,
  formatWant,
  parseBid,
  parseDelivered,
} from '../../../packages/agent-runtime/src/market/protocol.ts'

const API = process.env.PLATFORM_API_URL ?? 'http://localhost:8801'
const TOKEN = process.env.AGENT_API_TOKEN ?? ''
const BID_WINDOW_MS = Number(process.env.BID_WINDOW_MS ?? 30_000)
const ESCROW_DEADLINE_SECS = Number(process.env.ESCROW_DEADLINE_SECS ?? 72 * 60 * 60)
const DELIVERY_WAIT_MS = Number(process.env.DELIVERY_WAIT_MS ?? Math.min(ESCROW_DEADLINE_SECS * 1000, 15 * 60 * 1000))
const WORKER_AGENTS = (process.env.MARKETPLACE_WORKER_AGENTS ?? '').split(',').map((item) => item.trim()).filter(Boolean)

interface AgentJob {
  id: string
  title: string
  scope: string
  acceptanceCriteria: string
  amountSol: number
  reference: string
  marketplace: { round: number }
  settlement: {
    devnet?: {
      buyer: string
      reference: string
      deposit?: string
      release?: string
      refund?: string
    }
  }
}

async function api<T = any>(path: string, body?: Record<string, unknown>, agent = true): Promise<T> {
  const headers: Record<string, string> = body ? { 'Content-Type': 'application/json' } : {}
  if (agent) headers.Authorization = `Bearer ${TOKEN}`
  const res = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data as T
}

function wantFor(job: AgentJob) {
  return formatWant({
    round: job.marketplace.round,
    service: 'freelance',
    arg: JSON.stringify({
      id: job.id,
      title: job.title,
      scope: job.scope,
      acceptanceCriteria: job.acceptanceCriteria,
    }),
    budgetSol: job.amountSol,
  })
}

async function settle(job: AgentJob) {
  const result = await api<{ settled: 'released' | 'refunded' | null; job: AgentJob }>(`/api/agent/jobs/${job.id}/settle`, {})
  const devnet = result.job.settlement.devnet
  if (result.settled === 'released' && devnet?.release) return formatReleased({ round: job.marketplace.round, reference: devnet.reference, sig: devnet.release })
  if (result.settled === 'refunded' && devnet?.refund) return formatRefunded({ round: job.marketplace.round, reference: devnet.reference, sig: devnet.refund })
  return null
}

await startCoralAgent({ agentName: process.env.AGENT_NAME ?? 'marketplace-bridge' }, async (ctx) => {
  const active = new Set<string>()

  while (true) {
    if (!TOKEN) throw new Error('AGENT_API_TOKEN is required')
    const { jobs, settlements = [] } = await api<{ jobs: AgentJob[]; settlements?: AgentJob[] }>('/api/agent/jobs')

    for (const job of settlements) {
      try {
        const message = await settle(job)
        if (message) console.error(`[marketplace-bridge] settled ${job.id}: ${message}`)
      } catch (e) {
        console.error(`[marketplace-bridge] settle ${job.id}: ${(e as Error).message}`)
      }
    }

    for (const job of jobs) {
      if (active.has(job.id)) continue
      active.add(job.id)
      try {

      const threadId = await ctx.createThread(`freelance:${job.id}`, WORKER_AGENTS)
      await ctx.send(wantFor(job), threadId, WORKER_AGENTS)

      const deadline = Date.now() + BID_WINDOW_MS
      while (Date.now() < deadline) {
        const mention = await ctx.waitForMentionInThread(threadId, Math.min(5000, deadline - Date.now()))
        const bid = mention ? parseBid(mention.text) : null
        if (!bid || bid.round !== job.marketplace.round) continue
        try {
          await api(`/api/agent/jobs/${job.id}/bids`, { ...bid })
          await ctx.send(`BID_ACCEPTED round=${bid.round} by=${bid.by} price=${bid.priceSol}`, threadId, [bid.by])
        } catch (e) {
          await ctx.send(`BID_REJECTED round=${bid.round} by=${bid.by} reason="${String((e as Error).message).replace(/"/g, "'")}"`, threadId, [bid.by])
        }
      }

      const awarded = await api<{ bid: { by: string; priceSol: number }; job: AgentJob }>(`/api/agent/jobs/${job.id}/award`, { deadlineSecs: ESCROW_DEADLINE_SECS })
      const devnet = awarded.job.settlement.devnet
      await ctx.send(formatAward(job.marketplace.round, awarded.bid.by, 'cheapest valid bid'), threadId, [awarded.bid.by])
      if (devnet?.deposit) {
        await ctx.send(formatDeposited({ round: job.marketplace.round, reference: devnet.reference, buyer: devnet.buyer, sig: devnet.deposit }), threadId, [awarded.bid.by])
      }

      const deliveryDeadline = Date.now() + DELIVERY_WAIT_MS
      while (Date.now() < deliveryDeadline) {
        const mention = await ctx.waitForMentionInThread(threadId, Math.min(30_000, deliveryDeadline - Date.now()))
        const delivered = mention ? parseDelivered(mention.text) : null
        if (!delivered || delivered.round !== job.marketplace.round) continue
        await api(`/api/agent/jobs/${job.id}/delivery`, { by: awarded.bid.by, ...delivered })
        const settled = await settle(awarded.job)
        await ctx.send(settled ?? `SETTLEMENT_PENDING round=${job.marketplace.round}`, threadId, [awarded.bid.by])
        break
      }

      } catch (e) {
        console.error(`[marketplace-bridge] ${job.id}: ${(e as Error).message}`)
      } finally {
        active.delete(job.id)
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
})
