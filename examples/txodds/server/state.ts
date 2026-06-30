import { createHash } from 'node:crypto'
import { PublicKey } from '@solana/web3.js'
import type { ReviewResult } from '../agent/review.js'

export const ARBITER_TOP_UP_THRESHOLD_SOL = 0.01
export const ARBITER_TOP_UP_SOL = 0.02

export type JobStatus =
  | 'funding_failed'
  | 'funded'
  | 'submitted'
  | 'approved'
  | 'released'
  | 'rejected'
  | 'disputed'
  | 'refunded'

export interface JobPayload {
  title: string
  requirements: string
  acceptanceCriteria: string
  amountSol: number
  deadlineSecs: number
}

export interface Message {
  id: string
  author: 'employer' | 'worker' | 'agent'
  text: string
  at: string
}

export interface Submission {
  url: string
  repo: string
  notes: string
  at: string
}

export interface SettlementMeta {
  mode: 'arbiter'
  amountSol: number
  reference: string
  preimage: string
  employer?: string
  worker?: string
  arbiter?: string
  vault?: string
  escrow?: string
  open?: { sig: string; explorer: string }
  release?: { sig: string; explorer: string }
  refund?: { sig: string; explorer: string }
  error?: string
}

export interface FundingQuote {
  amountSol: number
  escrowRentSol: number
  arbiterTopUpSol: number
  estimatedDebitSol: number
  feeNote: string
  explanation: string
}

export function buildFundingQuote(amountSol: number, escrowRentSol: number, arbiterBalanceSol: number | null): FundingQuote {
  const arbiterTopUpSol = arbiterBalanceSol != null && arbiterBalanceSol < ARBITER_TOP_UP_THRESHOLD_SOL
    ? ARBITER_TOP_UP_SOL
    : 0
  const rounded = (value: number): number => Number(value.toFixed(9))
  return {
    amountSol: rounded(amountSol),
    escrowRentSol: rounded(escrowRentSol),
    arbiterTopUpSol: rounded(arbiterTopUpSol),
    estimatedDebitSol: rounded(amountSol + escrowRentSol + arbiterTopUpSol),
    feeNote: 'Network transaction fees are small and variable, so they are not included in this estimate.',
    explanation: arbiterTopUpSol > 0
      ? `Employer debit includes the job budget, escrow rent, and a ${ARBITER_TOP_UP_SOL} SOL arbiter fee-wallet top-up because the arbiter is below ${ARBITER_TOP_UP_THRESHOLD_SOL} SOL. On approved release, escrow rent returns to the vault PDA used by the deployed arbiter wrapper.`
      : 'Employer debit includes the job budget and escrow rent. Arbiter top-up is not needed at the current balance. On approved release, escrow rent returns to the vault PDA used by the deployed arbiter wrapper.',
  }
}

export interface Dispute {
  id: string
  note: string
  at: string
  review?: ReviewResult
}

export interface JobEvent {
  id: string
  at: string
  type:
    | 'created'
    | 'funding_failed'
    | 'funded'
    | 'message'
    | 'submitted'
    | 'reviewed'
    | 'release_failed'
    | 'released'
    | 'disputed'
    | 'refunded'
    | 'retry'
  actor: 'employer' | 'worker' | 'agent' | 'system'
  summary: string
}

export interface Job {
  id: string
  nonce: number
  createdAt: string
  deadlineAt: string
  status: JobStatus
  title: string
  requirements: string
  acceptanceCriteria: string
  amountSol: number
  deadlineSecs: number
  reference: string
  preimage: string
  messages: Message[]
  submission?: Submission
  review?: ReviewResult
  reviews: ReviewResult[]
  settlement: SettlementMeta
  fundingQuote?: FundingQuote
  disputes: Dispute[]
  events: JobEvent[]
}

export function normalizeJobPayload(input: Partial<JobPayload>): JobPayload {
  const amountSol = Math.max(0.001, Number(input.amountSol) || 0.001)
  const deadlineSecs = Math.max(30, Math.floor(Number(input.deadlineSecs) || 3600))
  return {
    title: String(input.title || '').trim() || 'Untitled freelance task',
    requirements: String(input.requirements || '').trim(),
    acceptanceCriteria: String(input.acceptanceCriteria || '').trim(),
    amountSol,
    deadlineSecs,
  }
}

export function jobReference(payload: JobPayload, nonce: number): { reference: string; preimage: string } {
  const stable = JSON.stringify({
    title: payload.title,
    requirements: payload.requirements,
    acceptanceCriteria: payload.acceptanceCriteria,
    amountSol: payload.amountSol,
    deadlineSecs: payload.deadlineSecs,
    nonce,
  })
  const preimage = `freelance-escrow:${stable}`
  return { reference: new PublicKey(createHash('sha256').update(preimage).digest()).toBase58(), preimage }
}

export function createJob(id: string, payloadInput: Partial<JobPayload>, nonce = Date.now()): Job {
  const payload = normalizeJobPayload(payloadInput)
  const ref = jobReference(payload, nonce)
  const created = new Date()
  return {
    id,
    nonce,
    createdAt: created.toISOString(),
    deadlineAt: new Date(created.getTime() + payload.deadlineSecs * 1000).toISOString(),
    status: 'funding_failed',
    ...payload,
    ...ref,
    messages: [],
    reviews: [],
    settlement: { mode: 'arbiter', amountSol: payload.amountSol, ...ref },
    disputes: [],
    events: [],
  }
}

export function addEvent(
  job: Job,
  id: string,
  type: JobEvent['type'],
  actor: JobEvent['actor'],
  summary: string,
  at = new Date().toISOString(),
): JobEvent {
  const event = { id, type, actor, summary, at }
  job.events.push(event)
  return event
}

export function canOpenFunding(job: Job): boolean {
  return !job.settlement.open && !job.settlement.release && !job.settlement.refund
}

export function markFundingFailed(job: Job, error: string): void {
  if (!canOpenFunding(job)) return
  job.status = 'funding_failed'
  job.settlement.error = error
}

export function setFundingQuote(job: Job, quote: FundingQuote): void {
  job.fundingQuote = quote
}

export function markFunded(
  job: Job,
  settlement: Pick<SettlementMeta, 'employer' | 'worker' | 'arbiter' | 'vault' | 'escrow' | 'open'>,
): void {
  if (job.settlement.open) return
  if (job.settlement.release || job.settlement.refund) throw new Error('cannot fund a settled escrow')
  job.status = 'funded'
  job.settlement = { ...job.settlement, ...settlement, error: undefined }
}

export function addMessage(job: Job, id: string, author: Message['author'], text: string, at = new Date().toISOString()): Message {
  if (author !== 'employer' && author !== 'worker' && author !== 'agent') throw new Error('invalid message author')
  const msg = { id, author, text: text.trim(), at }
  if (!msg.text) throw new Error('message text is required')
  job.messages.push(msg)
  return msg
}

export function submitDelivery(job: Job, input: Partial<Submission>, at = new Date().toISOString()): Submission {
  if (!['funded', 'submitted', 'rejected', 'disputed'].includes(job.status)) {
    throw new Error('cannot submit before escrow is funded')
  }
  const submission = {
    url: String(input.url || '').trim(),
    repo: String(input.repo || '').trim(),
    notes: String(input.notes || '').trim(),
    at,
  }
  if (![submission.url, submission.repo, submission.notes].some(Boolean)) throw new Error('submission evidence is required')
  job.submission = submission
  job.status = 'submitted'
  return submission
}

export function assertCanRelease(job: Job): void {
  if (job.settlement.release) throw new Error('escrow already released')
  if (!job.submission) throw new Error('cannot release before worker submission')
  if (!['submitted', 'approved', 'disputed', 'rejected'].includes(job.status)) {
    throw new Error(`cannot release from status ${job.status}`)
  }
}

export function recordReview(job: Job, review: ReviewResult): void {
  job.review = review
  job.reviews.push(review)
}

export function assertCanRetryRelease(job: Job): void {
  if (!job.review?.approved) throw new Error('approved review is required before retrying release')
  if (job.status !== 'approved') throw new Error(`cannot retry release from status ${job.status}`)
  assertCanRelease(job)
}

export function assertCanRefund(job: Job, now = Date.now()): void {
  if (job.settlement.release) throw new Error('escrow already released')
  if (job.settlement.refund) throw new Error('escrow already refunded')
  if (!job.settlement.open) throw new Error('escrow was not funded')
  if (!['rejected', 'disputed'].includes(job.status)) throw new Error('refund requires a rejected or disputed job')
  if (now < Date.parse(job.deadlineAt)) throw new Error('refund is only available after the escrow deadline')
}

export function markReleaseFailed(job: Job, error: string, review?: ReviewResult): void {
  if (review && job.review !== review) recordReview(job, review)
  job.status = 'approved'
  job.settlement.error = error
}

export function markReleased(job: Job, release: { sig: string; explorer: string }, review?: ReviewResult): void {
  assertCanRelease(job)
  if (review && job.review !== review) recordReview(job, review)
  job.settlement.release = release
  job.settlement.error = undefined
  job.status = 'released'
}

export function markRefunded(
  job: Job,
  refund: { sig: string; explorer: string },
  settlement: Pick<SettlementMeta, 'employer' | 'arbiter'>,
): void {
  assertCanRefund(job)
  job.status = 'refunded'
  job.settlement = { ...job.settlement, ...settlement, refund, error: undefined }
}
