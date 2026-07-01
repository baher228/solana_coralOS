import http from 'node:http'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import bs58 from 'bs58'
import { Keypair, PublicKey } from '@solana/web3.js'

const ENV_PATH = process.env.KIT_ENV ?? fileURLToPath(new URL('../../../.env', import.meta.url))
const DATA_DIR = fileURLToPath(new URL('../.data/', import.meta.url))
const DATA_FILE = `${DATA_DIR}jobs.json`
const PORT = Number(process.env.PORT ?? 8801)

type Actor = 'employer' | 'worker' | 'agent' | 'system'
type Status = 'funded' | 'submitted' | 'approved' | 'released' | 'revision_requested' | 'disputed' | 'refunded' | 'cancelled'

interface Event { at: string; actor: Actor; type: string; summary: string }
interface Message { at: string; author: Exclude<Actor, 'system'>; text: string }
interface Submission { at: string; url: string; repo: string; notes: string }
interface Review { at: string; approved: boolean; score: number; summary: string; missing: string[] }
interface Job {
  id: string
  status: Status
  createdAt: string
  title: string
  requirements: string
  acceptanceCriteria: string
  amountSol: number
  reference: string
  messages: Message[]
  submission?: Submission
  review?: Review
  settlement: { mode: 'local-demo'; escrow: string; release?: string; refund?: string }
  events: Event[]
}

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
    const list = JSON.parse(await fs.readFile(DATA_FILE, 'utf8')) as Job[]
    for (const job of list) jobs.set(job.id, job)
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

function referenceFor(input: string): string {
  return new PublicKey(createHash('sha256').update(input).digest()).toBase58()
}

function normalizeBody(input: Record<string, unknown>) {
  return {
    title: String(input.title || '').trim() || 'Untitled freelance task',
    requirements: String(input.requirements || '').trim(),
    acceptanceCriteria: String(input.acceptanceCriteria || '').trim(),
    amountSol: Math.max(0.001, Number(input.amountSol) || 0.001),
  }
}

function addEvent(job: Job, actor: Actor, type: string, summary: string) {
  job.events.unshift({ at: new Date().toISOString(), actor, type, summary })
}

export function createJob(input: Record<string, unknown>): Job {
  const payload = normalizeBody(input)
  if (payload.requirements.length < 12 || payload.acceptanceCriteria.length < 12) {
    throw Object.assign(new Error('requirements and acceptance criteria must be specific'), { status: 400 })
  }
  const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  const reference = referenceFor(`freelance:${id}:${JSON.stringify(payload)}`)
  const job: Job = {
    id,
    status: 'funded',
    createdAt: new Date().toISOString(),
    ...payload,
    reference,
    messages: [],
    settlement: { mode: 'local-demo', escrow: `local-${reference.slice(0, 12)}` },
    events: [],
  }
  addEvent(job, 'employer', 'funded', `Escrow opened for ${job.amountSol} SOL`)
  jobs.set(id, job)
  return job
}

export function reviewJob(job: Job): Review {
  if (!job.submission) throw Object.assign(new Error('worker submission is required'), { status: 400 })
  const haystack = `${job.submission.url} ${job.submission.repo} ${job.submission.notes}`.toLowerCase()
  const terms = `${job.requirements} ${job.acceptanceCriteria}`.toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 4)
  const hits = new Set(terms.filter((w) => haystack.includes(w)))
  const hasEvidence = Boolean(job.submission.url || job.submission.repo || job.submission.notes.length > 30)
  const score = Math.min(100, Math.round((hits.size / Math.max(1, terms.length)) * 70 + (hasEvidence ? 30 : 0)))
  const missing = [...new Set(terms.filter((w) => !hits.has(w)))].slice(0, 5)
  const review = {
    at: new Date().toISOString(),
    approved: score >= 45 && hasEvidence,
    score,
    summary: score >= 45 && hasEvidence
      ? 'Delivery includes enough evidence to release the local demo escrow.'
      : 'Delivery needs clearer evidence before release.',
    missing,
  }
  job.review = review
  job.status = review.approved ? 'released' : 'revision_requested'
  if (review.approved) job.settlement.release = `demo-release-${job.reference.slice(0, 10)}`
  addEvent(job, 'agent', review.approved ? 'released' : 'revision_requested', review.summary)
  return review
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function state() {
  const w = wallets()
  return {
    jobs: [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    setup: {
      wallets: w,
      mode: 'local-demo',
      note: w.configured
        ? 'Fresh devnet wallets are configured. This demo keeps escrow local until you wire a direct program deployment.'
        : 'No secrets are checked in. Run node scripts/setup.js to generate fresh local devnet wallets.',
    },
  }
}

export function createHandler(): http.RequestListener {
  return async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return send(res, 204, {})

  try {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`)
    const route = url.pathname.match(/^\/api\/jobs\/([^/]+)\/(messages|submission|review|dispute|refund|cancel)$/)

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, product: 'freelance-escrow', ...state().setup })
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, state())
    if (req.method === 'GET' && url.pathname === '/api/export') {
      return send(res, 200, { exportedAt: new Date().toISOString(), ...state() })
    }
    if (req.method === 'POST' && url.pathname === '/api/import') {
      const body = await readJson(req)
      const imported = Array.isArray(body.jobs) ? body.jobs as Job[] : []
      jobs.clear()
      for (const job of imported) if (job?.id) jobs.set(job.id, job)
      await saveJobs()
      return send(res, 200, state())
    }
    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      const job = createJob(await readJson(req))
      await saveJobs()
      return send(res, 201, state())
    }
    if (req.method === 'POST' && url.pathname === '/api/demo/seed') {
      jobs.clear()
      const job = createJob({
        title: 'Build a landing page checkout section',
        requirements: 'Responsive layout, clear pricing, accessible buttons, and deployment notes.',
        acceptanceCriteria: 'Includes preview URL, repo link, mobile proof, and notes for each acceptance item.',
        amountSol: 0.001,
      })
      job.messages.push({ at: new Date().toISOString(), author: 'employer', text: 'Please include mobile screenshots and the repo.' })
      addEvent(job, 'system', 'seeded', 'Demo job seeded')
      await saveJobs()
      return send(res, 200, state())
    }
    if (req.method === 'POST' && url.pathname === '/api/state/reset') {
      jobs.clear()
      await saveJobs()
      return send(res, 200, state())
    }
    if (req.method === 'POST' && route) {
      const [, id, action] = route
      const job = jobs.get(id)
      if (!job) throw Object.assign(new Error('job not found'), { status: 404 })
      const body = await readJson(req)
      if (action === 'messages') {
        const author = body.author === 'worker' ? 'worker' : body.author === 'agent' ? 'agent' : 'employer'
        const text = String(body.text || '').trim()
        if (!text) throw Object.assign(new Error('message text is required'), { status: 400 })
        job.messages.push({ at: new Date().toISOString(), author, text })
        addEvent(job, author, 'message', text.slice(0, 80))
      } else if (action === 'submission') {
        job.submission = {
          at: new Date().toISOString(),
          url: String(body.url || '').trim(),
          repo: String(body.repo || '').trim(),
          notes: String(body.notes || '').trim(),
        }
        if (!job.submission.url && !job.submission.repo && !job.submission.notes) {
          throw Object.assign(new Error('submission evidence is required'), { status: 400 })
        }
        job.status = 'submitted'
        addEvent(job, 'worker', 'submitted', 'Worker submitted delivery evidence')
      } else if (action === 'review') {
        reviewJob(job)
      } else if (action === 'dispute') {
        job.status = 'disputed'
        addEvent(job, 'employer', 'disputed', String(body.note || 'Employer opened a dispute'))
      } else if (action === 'refund') {
        job.status = 'refunded'
        job.settlement.refund = `demo-refund-${job.reference.slice(0, 10)}`
        addEvent(job, 'system', 'refunded', 'Local demo escrow refunded')
      } else if (action === 'cancel') {
        job.status = 'cancelled'
        addEvent(job, 'employer', 'cancelled', 'Job cancelled')
      }
      await saveJobs()
      return send(res, 200, state())
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
