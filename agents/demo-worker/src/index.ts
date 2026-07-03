import http from 'node:http'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { complete } from '@pay/agent-runtime/src/llm/complete.ts'
import { startCoralAgent } from '@pay/agent-runtime/src/coral/server.ts'
import {
  formatDelivered,
  parseAward,
  parseDeposited,
  parseRefunded,
  parseReleased,
  verb,
} from '@pay/agent-runtime/src/market/protocol.ts'
import {
  apiBidPayload,
  bidMessage,
  chooseBidPrice,
  deliveryNotes,
  deliveryPayload,
  generatedDeliveryHtml,
  hasAgentBid,
  isAwardedToAgent,
  parseFreelanceWant,
  type ApiAgentJob,
  type DemoJob,
} from './logic.ts'

const ROOT_ENV = fileURLToPath(new URL('../../../.env', import.meta.url))
const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/preview/', import.meta.url))
const GENERATED_ROOT = process.env.DEMO_DELIVERY_DIR || path.join(tmpdir(), 'solana-coralos-demo-worker')

async function loadRootEnv() {
  try {
    for (const line of (await fs.readFile(ROOT_ENV, 'utf8')).split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    // Fresh demo checkouts may not have .env yet.
  }
}

async function serveDirectory(rootDir: string, port: number): Promise<string> {
  const root = path.resolve(rootDir)
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '')
      const file = path.resolve(root, rel)
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.statusCode = 403
        res.end('forbidden')
        return
      }
      const stat = await fs.stat(file)
      const chosen = stat.isDirectory() ? path.join(file, 'index.html') : file
      res.setHeader('Content-Type', chosen.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8')
      res.end(await fs.readFile(chosen))
    } catch {
      res.statusCode = 404
      res.end('not found')
    }
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  return `http://127.0.0.1:${actualPort}/`
}

function key(threadId: string | undefined, round: number) {
  return `${threadId || 'thread'}:${round}`
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

await loadRootEnv()

const agentName = process.env.AGENT_NAME || 'demo-worker'
const wallet = process.env.DEMO_WORKER_WALLET || process.env.WALLET || ''
const deliveryRepo = process.env.DEMO_DELIVERY_REPO || ''
const deliveryDelayMs = Number(process.env.DEMO_DELIVERY_DELAY_MS ?? 1500)
const fixturePort = Number(process.env.DEMO_DELIVERY_PORT ?? 4177)
const generateDelivery = process.env.DEMO_GENERATE_DELIVERY === '1'
const transport = (process.env.AGENT_TRANSPORT || 'api').toLowerCase()
const apiBase = process.env.AGENT_API_BASE || process.env.PLATFORM_API_URL || 'http://localhost:8801'
const apiToken = process.env.AGENT_API_TOKEN || ''
const pollMs = Number(process.env.DEMO_AGENT_POLL_MS ?? 3000)

let fixtureUrl: string | null = process.env.DEMO_DELIVERY_URL || null

function safePath(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'delivery'
}

async function generatedPreviewPath(job: DemoJob) {
  const rel = safePath(job.id)
  const dir = path.join(GENERATED_ROOT, rel)
  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'index.html'), generatedDeliveryHtml(job, agentName))
  return rel
}

async function previewUrl(job: DemoJob) {
  if (process.env.DEMO_DELIVERY_URL) return process.env.DEMO_DELIVERY_URL
  if (generateDelivery) {
    const rel = await generatedPreviewPath(job)
    fixtureUrl ||= await serveDirectory(GENERATED_ROOT, fixturePort)
    const url = new URL(`${rel}/`, fixtureUrl).toString()
    console.error(`[${agentName}] serving generated delivery at ${url}`)
    return url
  }
  fixtureUrl ||= await serveDirectory(FIXTURE_ROOT, fixturePort)
  return fixtureUrl
}

async function api<T = any>(path: string, body?: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${apiToken}` }
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${apiBase}${path}`, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data as T
}

async function deliver(job: DemoJob & { marketplace?: { round?: number } }) {
  const url = await previewUrl(job)
  if (deliveryDelayMs > 0) await sleep(deliveryDelayMs)
  const notes = await deliveryNotes(job, process.env.DEMO_DELIVERY_NOTES, complete)
  return {
    round: job.marketplace?.round || 1,
    url,
    ...(deliveryRepo ? { repo: deliveryRepo } : {}),
    notes,
  }
}

async function runApiWorker() {
  if (!apiToken) throw new Error('Set AGENT_API_TOKEN to the token from Connect Agent')
  const delivered = new Set<string>()
  const loggedSettlement = new Set<string>()
  console.error(`[${agentName}] polling ${apiBase} as a platform-connected agent`)

  while (true) {
    try {
      const { jobs = [] } = await api<{ jobs: ApiAgentJob[] }>('/api/agent/jobs')
      for (const job of jobs) {
        if (job.status === 'open' && !hasAgentBid(job, agentName)) {
          const bid = apiBidPayload(job, agentName, wallet, process.env.DEMO_BID_PRICE_SOL)
          await api(`/api/agent/jobs/${job.id}/bids`, bid)
          console.error(`[${agentName}] bid ${bid.priceSol} SOL on ${job.id}`)
          continue
        }

        if (isAwardedToAgent(job, agentName) && job.status === 'funded' && !delivered.has(job.id)) {
          await api(`/api/agent/jobs/${job.id}/delivery`, await deliver(job))
          delivered.add(job.id)
          console.error(`[${agentName}] delivered ${job.id}`)
          continue
        }

        if (isAwardedToAgent(job, agentName) && ['released', 'refunded'].includes(job.status) && !loggedSettlement.has(job.id)) {
          loggedSettlement.add(job.id)
          console.error(`[${agentName}] ${job.status} ${job.id}`)
        }
      }
    } catch (e) {
      console.error(`[${agentName}] api loop: ${(e as Error).message}`)
    }
    await sleep(Number.isFinite(pollMs) && pollMs > 0 ? pollMs : 3000)
  }
}

async function runCoralWorker() {
  if (!wallet) throw new Error('Set DEMO_WORKER_WALLET or WALLET before running the Coral demo worker')
  const jobs = new Map<string, { job: DemoJob; awarded: boolean }>()
  await startCoralAgent({ agentName }, async (ctx) => {
    while (true) {
      const mention = await ctx.waitForMention()
      if (!mention) continue

      const want = parseFreelanceWant(mention.text)
      if (want) {
        const priceSol = chooseBidPrice(want.budgetSol, process.env.DEMO_BID_PRICE_SOL)
        jobs.set(key(mention.threadId, want.round), { job: want.job, awarded: false })
        await ctx.reply(mention, bidMessage({ round: want.round, priceSol, by: agentName, wallet }))
        console.error(`[${agentName}] bid ${priceSol} SOL on ${want.job.id}`)
        continue
      }

      if (verb(mention.text) === 'BID_ACCEPTED' || verb(mention.text) === 'BID_REJECTED') {
        console.error(`[${agentName}] ${mention.text}`)
        continue
      }

      const award = parseAward(mention.text)
      if (award) {
        if (award.to !== agentName) continue
        const item = jobs.get(key(mention.threadId, award.round))
        if (item) item.awarded = true
        console.error(`[${agentName}] awarded round ${award.round}`)
        continue
      }

      const deposited = parseDeposited(mention.text)
      if (deposited) {
        const item = jobs.get(key(mention.threadId, deposited.round))
        if (!item?.awarded) continue
        await ctx.reply(mention, formatDelivered(deliveryPayload(deposited.round, await deliver(item.job))))
        console.error(`[${agentName}] delivered round ${deposited.round}`)
        continue
      }

      const released = parseReleased(mention.text)
      if (released) {
        console.error(`[${agentName}] released ${released.sig}`)
        continue
      }

      const refunded = parseRefunded(mention.text)
      if (refunded) console.error(`[${agentName}] refunded ${refunded.sig}`)
    }
  })
}

if (transport === 'coral') await runCoralWorker()
else await runApiWorker()
