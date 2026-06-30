/**
 * Freelance escrow demo API.
 *
 * Devnet-only demo API: an employer opens an arbiter-controlled escrow, a worker submits evidence,
 * and a neutral review agent decides whether to release funds to the worker or keep the dispute path open.
 */
import http from 'node:http'
import { reviewDelivery, type ReviewInput, type ReviewResult } from '../agent/review.js'
import {
  addMessage,
  addEvent,
  assertCanRetryRelease,
  canOpenFunding,
  createJob,
  recordReview,
  markFundingFailed,
  markReleaseFailed,
  setFundingQuote,
  submitDelivery,
  type Job,
  type Message,
} from './state.js'
import { HttpError, readJson, send } from './http.js'
import { loadJobs, saveJobs } from './persistence.js'
import { PORT, RPC, explorerLink } from './runtime.js'
import {
  ARBITER_PROGRAM_ID,
  arbiterMismatchMessage,
  balancesFor,
  configuredArbiterAddress,
  health,
  openEscrow,
  quoteFunding,
  refundEscrow,
  releaseEscrow,
} from './settlement.js'
import { walletSnapshot } from './wallets.js'

const jobs = new Map<string, Job>((await loadJobs()).map((job) => [job.id, job]))
let seq = 0

const nextId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${(++seq).toString(36)}`
const saveAll = (): Promise<void> => saveJobs(jobs.values())

function reviewInput(job: Job): ReviewInput {
  const disputeMessages = job.disputes.map((d) => ({
    author: 'employer' as const,
    at: d.at,
    text: `Dispute note: ${d.note}`,
  }))
  return {
    title: job.title,
    requirements: job.requirements,
    acceptanceCriteria: job.acceptanceCriteria,
    messages: [...job.messages, ...disputeMessages],
    submission: job.submission,
  }
}

async function runReview(job: Job, disputed = false): Promise<void> {
  if (job.settlement.release) throw new HttpError(409, 'escrow already released')
  if (job.settlement.refund) throw new HttpError(409, 'escrow already refunded')
  if (!job.submission) throw new HttpError(409, 'worker submission is required before review')
  const review = await reviewDelivery(reviewInput(job))
  recordReview(job, review)
  addEvent(job, nextId('evt'), 'reviewed', 'agent', `${review.approved ? 'Approved' : 'Rejected'} at ${review.score}/100`)
  addMessage(job, nextId('msg'), 'agent', `${review.approved ? 'Approved' : 'Rejected'} (${review.score}/100): ${review.summary}`)

  if (!review.approved) {
    job.status = disputed ? 'disputed' : 'rejected'
    return
  }

  try {
    await releaseEscrow(job, review)
    addEvent(job, nextId('evt'), 'released', 'agent', 'Escrow released to worker')
  } catch (e) {
    markReleaseFailed(job, (e as Error).message, review)
    addEvent(job, nextId('evt'), 'release_failed', 'agent', (e as Error).message)
  }
}

async function retryRelease(job: Job): Promise<void> {
  assertCanRetryRelease(job)
  addEvent(job, nextId('evt'), 'retry', 'agent', 'Retrying on-chain release')
  try {
    await releaseEscrow(job, job.review as ReviewResult)
    addEvent(job, nextId('evt'), 'released', 'agent', 'Escrow released to worker')
  } catch (e) {
    markReleaseFailed(job, (e as Error).message)
    addEvent(job, nextId('evt'), 'release_failed', 'agent', (e as Error).message)
  }
}

async function fundJob(job: Job): Promise<void> {
  if (!canOpenFunding(job)) return
  if (!job.fundingQuote) {
    try { setFundingQuote(job, await quoteFunding(job.amountSol)) } catch { /* quote is best-effort */ }
  }
  try {
    await openEscrow(job)
    addEvent(job, nextId('evt'), 'funded', 'system', `Escrow funded for ${job.amountSol} SOL`)
  } catch (e) {
    markFundingFailed(job, (e as Error).message)
    addEvent(job, nextId('evt'), 'funding_failed', 'system', (e as Error).message)
  }
}

function serializeJob(job: Job): Job & { deadlinePassed: boolean; links: Record<string, string | undefined> } {
  return {
    ...job,
    deadlinePassed: Date.now() >= Date.parse(job.deadlineAt),
    links: {
      reference: explorerLink('address', job.reference),
      vault: job.settlement.vault ? explorerLink('address', job.settlement.vault) : undefined,
      escrow: job.settlement.escrow ? explorerLink('address', job.settlement.escrow) : undefined,
      open: job.settlement.open?.explorer,
      release: job.settlement.release?.explorer,
      refund: job.settlement.refund?.explorer,
    },
  }
}

async function state(url: URL): Promise<unknown> {
  const selectedId = url.searchParams.get('jobId') ?? Array.from(jobs.keys()).at(-1)
  const selected = selectedId ? jobs.get(selectedId) : undefined
  const wallets = walletSnapshot()
  const addresses: Record<string, string | null> = {
    ...wallets.addresses,
    vault: selected?.settlement.vault ?? null,
    escrow: selected?.settlement.escrow ?? null,
  }
  if (wallets.addresses.arbiter) {
    const configured = await configuredArbiterAddress()
    if (configured) {
      addresses.configuredArbiter = configured
      wallets.addresses.configuredArbiter = configured
      if (configured !== wallets.addresses.arbiter) {
        wallets.errors.arbiterConfig = arbiterMismatchMessage(wallets.addresses.arbiter, configured)
      }
    }
  }

  return {
    network: {
      cluster: 'devnet',
      rpcUrl: RPC,
      arbiterProgram: ARBITER_PROGRAM_ID.toBase58(),
      explorerCluster: 'devnet',
    },
    wallets,
    balances: await balancesFor(addresses),
    jobs: Array.from(jobs.values()).map(serializeJob),
    selectedJob: selected ? serializeJob(selected) : null,
  }
}

function findJob(id: string): Job {
  const job = jobs.get(id)
  if (!job) throw new HttpError(404, 'job not found')
  return job
}

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return send(res, 204, {})

  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
    const route = url.pathname.match(/^\/api\/jobs\/([^/]+)\/(messages|submission|review|release|dispute|refund|fund)$/)

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return send(res, 200, await state(url))
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, await health())
    }

    if (req.method === 'POST' && url.pathname === '/api/quote') {
      const body = await readJson(req)
      return send(res, 200, await quoteFunding(Number(body.amountSol)))
    }

    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      const body = await readJson(req)
      if (!String(body.requirements || '').trim()) throw new HttpError(400, 'requirements are required')
      const job = createJob(nextId('job'), body)
      jobs.set(job.id, job)
      addEvent(job, nextId('evt'), 'created', 'employer', `Job created for ${job.amountSol} SOL`)
      try { setFundingQuote(job, await quoteFunding(job.amountSol)) } catch { /* state still records funding failure below */ }
      await fundJob(job)
      await saveAll()
      return send(res, 201, await state(new URL(`/api/state?jobId=${job.id}`, `http://localhost:${PORT}`)))
    }

    if (req.method === 'POST' && route) {
      const [, id, action] = route
      const job = findJob(id)
      const body = await readJson(req)

      if (action === 'messages') {
        const author = String(body.author || '')
        if (author !== 'employer' && author !== 'worker') throw new HttpError(400, 'author must be employer or worker')
        addMessage(job, nextId('msg'), author as Message['author'], String(body.text || ''))
        addEvent(job, nextId('evt'), 'message', author as Message['author'], `Message added by ${author}`)
      } else if (action === 'submission') {
        submitDelivery(job, body)
        addEvent(job, nextId('evt'), 'submitted', 'worker', 'Delivery evidence submitted')
      } else if (action === 'review') {
        await runReview(job)
      } else if (action === 'fund') {
        addEvent(job, nextId('evt'), 'retry', 'employer', 'Retrying escrow funding')
        await fundJob(job)
      } else if (action === 'release') {
        await retryRelease(job)
      } else if (action === 'dispute') {
        const note = String(body.note || '').trim()
        if (!note) throw new HttpError(400, 'dispute note is required')
        if (job.settlement.release || job.settlement.refund) throw new HttpError(409, 'escrow already settled')
        const dispute: Job['disputes'][number] = { id: nextId('dispute'), note, at: new Date().toISOString() }
        job.disputes.push(dispute)
        addEvent(job, nextId('evt'), 'disputed', 'employer', note)
        await runReview(job, true)
        dispute.review = job.review
      } else if (action === 'refund') {
        await refundEscrow(job)
        addEvent(job, nextId('evt'), 'refunded', 'agent', 'Escrow refunded after deadline')
      }

      await saveAll()
      return send(res, 200, await state(new URL(`/api/state?jobId=${job.id}`, `http://localhost:${PORT}`)))
    }

    throw new HttpError(404, 'not found')
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    send(res, status, { error: (e as Error).message })
  }
}).listen(PORT, () => {
  console.error(`[freelance-escrow] API on http://localhost:${PORT} (GET /api/state, POST /api/jobs)`)
})
