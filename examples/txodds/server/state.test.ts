import { describe, expect, it } from 'vitest'
import {
  assertCanRelease,
  assertCanRefund,
  assertCanRetryRelease,
  buildFundingQuote,
  canOpenFunding,
  createJob,
  jobReference,
  markFunded,
  markFundingFailed,
  markRefunded,
  markReleaseFailed,
  markReleased,
  normalizeJobPayload,
  submitDelivery,
} from './state.js'

const payload = normalizeJobPayload({
  title: 'API docs',
  requirements: 'Write endpoint documentation and examples.',
  acceptanceCriteria: 'Includes auth, errors, and curl examples.',
  amountSol: 0.02,
  deadlineSecs: 900,
})

describe('jobReference', () => {
  it('is stable for the same payload plus nonce', () => {
    expect(jobReference(payload, 7).reference).toBe(jobReference(payload, 7).reference)
  })

  it('is unique across jobs', () => {
    const other = normalizeJobPayload({ ...payload, title: 'Different API docs' })
    expect(jobReference(payload, 7).reference).not.toBe(jobReference(other, 7).reference)
    expect(jobReference(payload, 7).reference).not.toBe(jobReference(payload, 8).reference)
  })
})

describe('job state transitions', () => {
  it('rejects submit before funding, release before submission, and double release', () => {
    const job = createJob('job_1', payload, 1)
    expect(() => submitDelivery(job, { notes: 'done' })).toThrow(/funded/)

    job.status = 'funded'
    expect(() => assertCanRelease(job)).toThrow(/submission/)

    submitDelivery(job, { notes: 'endpoint documentation, auth, errors, and curl examples delivered' })
    markReleased(job, { sig: 'releaseSig', explorer: 'https://example.test/releaseSig' })
    expect(() => markReleased(job, { sig: 'again', explorer: 'https://example.test/again' })).toThrow(/already released/)
  })

  it('marks funding failures and retries funding until the escrow is open', () => {
    const job = createJob('job_2', payload, 2)
    expect(canOpenFunding(job)).toBe(true)

    markFundingFailed(job, 'insufficient funds')
    expect(job.status).toBe('funding_failed')
    expect(job.settlement.error).toBe('insufficient funds')

    markFunded(job, {
      employer: 'employer',
      worker: 'worker',
      arbiter: 'arbiter',
      vault: 'vault',
      escrow: 'escrow',
      open: { sig: 'openSig', explorer: 'https://example.test/openSig' },
    })
    expect(job.status).toBe('funded')
    expect(job.settlement.error).toBeUndefined()
    expect(canOpenFunding(job)).toBe(false)

    markFunded(job, {
      employer: 'changed',
      worker: 'changed',
      arbiter: 'changed',
      vault: 'changed',
      escrow: 'changed',
      open: { sig: 'changed', explorer: 'https://example.test/changed' },
    })
    expect(job.settlement.open?.sig).toBe('openSig')
  })

  it('allows release retry after an approved review without changing the decision', () => {
    const job = createJob('job_3', payload, 3)
    markFunded(job, {
      employer: 'employer',
      worker: 'worker',
      arbiter: 'arbiter',
      vault: 'vault',
      escrow: 'escrow',
      open: { sig: 'openSig', explorer: 'https://example.test/openSig' },
    })
    submitDelivery(job, { notes: 'endpoint documentation, auth, errors, and curl examples delivered' })
    const review = {
      approved: true,
      score: 90,
      confidence: 0.8,
      summary: 'ok',
      missing: [],
      releaseReason: 'complete',
      criteria: [{ text: 'Includes auth', score: 90, verdict: 'pass' as const, evidence: 'auth', missing: '' }],
    }
    markReleaseFailed(job, 'arbiter fee too low', review)

    expect(() => assertCanRetryRelease(job)).not.toThrow()
    expect(job.review).toBe(review)
    expect(job.reviews).toEqual([review])
    expect(job.status).toBe('approved')
  })

  it('allows refund only after rejection, funding, and deadline', () => {
    const job = createJob('job_4', payload, 4)
    expect(() => assertCanRefund(job)).toThrow(/funded/)

    markFunded(job, {
      employer: 'employer',
      worker: 'worker',
      arbiter: 'arbiter',
      vault: 'vault',
      escrow: 'escrow',
      open: { sig: 'openSig', explorer: 'https://example.test/openSig' },
    })
    job.status = 'rejected'
    expect(() => assertCanRefund(job)).toThrow(/deadline/)

    job.deadlineAt = new Date(Date.now() - 1_000).toISOString()
    expect(() => assertCanRefund(job)).not.toThrow()
    markRefunded(job, { sig: 'refundSig', explorer: 'https://example.test/refundSig' }, {
      employer: 'employer',
      arbiter: 'arbiter',
    })
    expect(job.status).toBe('refunded')
    expect(job.settlement.refund?.sig).toBe('refundSig')
    expect(() => assertCanRefund(job)).toThrow(/already refunded/)
  })
})

describe('funding quote', () => {
  it('includes arbiter top-up only when the arbiter is below threshold', () => {
    expect(buildFundingQuote(0.001, 0.006, 0.009).arbiterTopUpSol).toBe(0.02)
    expect(buildFundingQuote(0.001, 0.006, 0.011).arbiterTopUpSol).toBe(0)
  })

  it('separates budget from estimated employer debit', () => {
    const quote = buildFundingQuote(0.001, 0.006, 0)
    expect(quote.amountSol).toBe(0.001)
    expect(quote.estimatedDebitSol).toBe(0.027)
    expect(quote.explanation).toMatch(/top-up/)
  })
})
