import { Keypair, PublicKey } from '@solana/web3.js'
import { deposit as escrowDeposit, escrowPda, makeProgram, release as escrowRelease, refund as escrowRefund } from '../../agent/escrow.ts'
import { BID_WINDOW_MS, DEFAULT_RPC_URL, ESCROW_DEADLINE_SECS } from '../config.js'
import { jobs } from '../store.js'
import type { Actor, DeliveryReviewMode, Job, MarketplaceBid, MarketplaceState, Milestone, Submission } from '../types.js'
import { activeDispute, addEvent, addSettlementEvent, deadlineFrom, deadlineFromNowSecs, ensureStatus, fail, makeMilestones, normalizeBody, now, participantName, publicKey, referenceFor, terminal, wallets, keypair } from './utils.js'

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
    evidenceUrls: evidenceList(input.evidenceUrls),
    photoUrls: evidenceList(input.photoUrls),
    videoUrls: evidenceList(input.videoUrls),
  }
  if (!submission.url && !submission.repo && !submission.notes && !submission.evidenceUrls.length && !submission.photoUrls.length && !submission.videoUrls.length) {
    fail('submission evidence is required')
  }
  job.submission = submission
  job.status = 'submitted'
  addEvent(job, 'worker', 'submitted', 'Worker submitted delivery evidence')
  addSettlementEvent(job, 'submitted', 'Delivery evidence attached to the funded escrow')
  return submission
}

function parseUrl(input: string): URL | null {
  try {
    return input ? new URL(input) : null
  } catch {
    return null
  }
}

function isLoopbackHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase())
}

function isPublicPreviewUrl(input: string): boolean {
  const url = parseUrl(input)
  return Boolean(url && ['http:', 'https:'].includes(url.protocol) && !isLoopbackHost(url.hostname))
}

function isPublicEvidenceUrl(input: string): boolean {
  return isPublicPreviewUrl(input)
}

function isLocalPreviewUrl(input: string): boolean {
  const url = parseUrl(input)
  return Boolean(url && ['http:', 'https:'].includes(url.protocol) && isLoopbackHost(url.hostname))
}

function isPublicGithubRepo(input: string): boolean {
  const url = parseUrl(input)
  if (!url || url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') return false
  const parts = url.pathname.replace(/\.git$/i, '').split('/').filter(Boolean)
  return parts.length >= 2
}

function evidenceList(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\n,]+/)
      : []
  return [...new Set(raw.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 12)
}

function validateAgentDeliveryEvidence(submission: Submission): void {
  const hasPublicPreview = isPublicPreviewUrl(submission.url)
  const hasPublicRepo = isPublicGithubRepo(submission.repo)
  const hasLocalPreview = isLocalPreviewUrl(submission.url)
  const hasPrivateRepo = Boolean(submission.repo && !hasPublicRepo)
  const evidenceUrls = [...(submission.evidenceUrls || []), ...(submission.photoUrls || []), ...(submission.videoUrls || [])]
  const hasWorkerEvidence = evidenceUrls.length > 0

  if (submission.repo && !hasPublicRepo) {
    fail('delivery evidence is not reviewable: repo must be a public GitHub HTTPS URL. Put public previews, screenshots, photos, or videos in url/evidenceUrls/photoUrls/videoUrls, not repo.')
  }

  const invalidEvidenceUrl = evidenceUrls.find((url) => !isPublicEvidenceUrl(url))
  if (invalidEvidenceUrl) {
    fail('delivery evidence is not reviewable: evidenceUrls/photoUrls/videoUrls must be public http(s) URLs visible to the platform.')
  }

  if (hasPublicPreview || hasPublicRepo || hasWorkerEvidence) return

  if (hasLocalPreview && hasPrivateRepo) {
    fail('delivery evidence is not reviewable: localhost/127.0.0.1 preview URLs and file/local repos are only visible on the worker machine. Submit a public forwarded preview URL or a public GitHub repo with build instructions.')
  }
  if (hasLocalPreview) {
    fail('delivery evidence is not reviewable: localhost/127.0.0.1 preview URLs are only visible on the worker machine. Forward/tunnel the port to a public URL before submitting, or submit a public GitHub repo.')
  }
  if (hasPrivateRepo) {
    fail('delivery evidence is not reviewable: repo must be a public GitHub HTTPS URL for worker-agent delivery.')
  }
  fail('delivery evidence is not reviewable: submit a public preview URL or a public GitHub repo with notes.')
}

export interface DevnetEscrowAdapterInput {
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

export function ensureMarketplace(job: Job): MarketplaceState {
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
  const candidate = {
    at: now(),
    url: String(input.url || '').trim(),
    repo: String(input.repo || '').trim(),
    notes: String(input.notes || '').trim(),
    evidenceUrls: evidenceList(input.evidenceUrls),
    photoUrls: evidenceList(input.photoUrls),
    videoUrls: evidenceList(input.videoUrls),
  }
  if (!candidate.url && !candidate.repo && !candidate.notes && !candidate.evidenceUrls.length && !candidate.photoUrls.length && !candidate.videoUrls.length) {
    fail('submission evidence is required')
  }
  validateAgentDeliveryEvidence(candidate)
  const submission = submitJob(job, input)
  marketplace.status = 'delivered'
  delete marketplace.awardError
  addEvent(job, 'agent', 'delivered', `${by || job.worker} submitted agent delivery`)
  return submission
}

export function deliveryReviewMode(input: Record<string, unknown>): DeliveryReviewMode {
  return String(input.reviewMode || '').trim() === 'coral-panel' ? 'coral-panel' : 'artifact-ai'
}

export function pendingPanelReviewJob(job: Job): boolean {
  return job.status === 'submitted'
    && job.settlement.mode === 'devnet-escrow'
    && Boolean(job.submission)
    && (!job.review || (job.review.source === 'coral-panel' && !job.review.panel?.verdict))
    && !terminal.has(job.status)
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
