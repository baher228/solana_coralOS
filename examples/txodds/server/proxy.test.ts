import { afterEach, describe, expect, it } from 'vitest'
import {
  approveReviewedJob,
  assessJobWithAi,
  cancelJob,
  claimJob,
  completeMilestone,
  createJob,
  disputeJob,
  refundJob,
  requestRevisionJob,
  resetJobsForTest,
  reviewJob,
  submitJob,
} from './proxy.js'

afterEach(() => resetJobsForTest())

function platformJob() {
  return createJob({
    title: 'Build checkout',
    employer: 'Northstar Studio',
    worker: 'Checkout Guild',
    scope: 'Responsive checkout with pricing and accessible buttons',
    acceptanceCriteria: 'Preview URL, repo link, mobile proof, and deployment notes',
    amountSol: 0.003,
    milestones: ['Layout', 'Responsive states', 'Delivery proof'],
  })
}

function openTask() {
  return createJob({
    title: 'Build marketplace task',
    employer: 'Northstar Studio',
    marketplace: true,
    scope: 'Responsive marketplace task card with budget, scope, and mobile proof',
    acceptanceCriteria: 'Includes preview URL, repo link, mobile proof, and notes for each acceptance item',
    amountSol: 0.003,
    milestones: ['Task card', 'Responsive states', 'Delivery proof'],
  })
}

function submittedTask(notes = 'Responsive marketplace task card with budget, scope, mobile proof, preview URL, and repo link.') {
  const job = openTask()
  claimJob(job, { worker: 'Checkout Guild' })
  submitJob(job, {
    url: 'https://example.test/preview',
    repo: 'https://example.test/repo',
    notes,
  })
  return job
}

function aiReply(input: Record<string, unknown>) {
  return async () => JSON.stringify(input)
}

describe('freelance escrow platform flow', () => {
  it('keeps legacy job creation funded when a worker is supplied', () => {
    const job = platformJob()
    expect(job.employer).toBe('Northstar Studio')
    expect(job.worker).toBe('Checkout Guild')
    expect(job.status).toBe('funded')
    expect(job.scope).toContain('Responsive checkout')
    expect(job.milestones).toHaveLength(3)
    expect(job.settlement.events[0].type).toBe('funded')
  })

  it('keeps the old demo POST shape funded without requiring a worker field', () => {
    const job = createJob({
      title: 'Legacy demo task',
      requirements: 'Write concise API documentation for auth, errors, pagination, and retries',
      acceptanceCriteria: 'Includes curl examples, setup notes, and a repo or public URL',
      amountSol: 0.002,
    })

    expect(job.status).toBe('funded')
    expect(job.worker).toBeTruthy()
  })

  it('creates an open marketplace task without a worker', () => {
    const job = openTask()

    expect(job.status).toBe('open')
    expect(job.worker).toBe('')
    expect(job.settlement.events).toHaveLength(0)
    expect(job.events[0].type).toBe('posted')
  })

  it('lets one worker claim an open task and blocks duplicate claims', () => {
    const job = openTask()

    claimJob(job, { worker: 'Checkout Guild' })

    expect(job.status).toBe('funded')
    expect(job.worker).toBe('Checkout Guild')
    expect(job.settlement.events[0].type).toBe('funded')
    expect(() => claimJob(job, { worker: 'Second Studio' })).toThrow(/cannot claim while job is funded/)
  })

  it('blocks delivery, settlement, refund, and worker dispute actions before claim', () => {
    const job = openTask()

    expect(() => submitJob(job, { notes: 'early evidence' })).toThrow(/cannot submit evidence/)
    expect(() => completeMilestone(job, job.milestones[0].id)).toThrow(/cannot complete milestones/)
    expect(() => reviewJob(job)).toThrow(/cannot review/)
    expect(() => disputeJob(job, { by: 'worker', note: 'before claim' })).toThrow(/cannot dispute/)
    expect(() => refundJob(job)).toThrow(/cannot refund/)

    cancelJob(job)

    expect(job.status).toBe('cancelled')
    expect(() => claimJob(job, { worker: 'Checkout Guild' })).toThrow(/cannot claim a cancelled job/)
  })

  it('submits evidence, completes milestones, and releases after sufficient review', () => {
    const job = openTask()
    claimJob(job, { worker: 'Checkout Guild' })
    completeMilestone(job, job.milestones[0].id)
    submitJob(job, {
      url: 'https://example.test/preview',
      repo: 'https://example.test/repo',
      notes: 'Responsive checkout includes pricing, accessible buttons, mobile proof, deployment notes, preview URL, and repo link.',
    })

    const review = reviewJob(job)

    expect(review.approved).toBe(true)
    expect(job.status).toBe('released')
    expect(job.settlement.release).toContain('demo-release')
    expect(job.milestones.every((m) => m.status === 'complete')).toBe(true)
  })

  it('stores AI approval without auto-releasing until employer approves', async () => {
    const job = submittedTask()

    const review = await assessJobWithAi(job, aiReply({
      score: 92,
      recommendation: 'approve',
      summary: 'Evidence satisfies the task.',
      checks: [
        { label: 'Preview URL', status: 'pass', reason: 'Preview link and notes are present.', evidence: 'preview and notes' },
        { label: 'Mobile proof', status: 'pass', reason: 'Worker described mobile proof.', evidence: 'submission notes' },
      ],
      missing: [],
      risks: [],
    }))

    expect(review.source).toBe('ai')
    expect(review.approved).toBe(true)
    expect(job.status).toBe('submitted')
    expect(job.settlement.release).toBeUndefined()

    approveReviewedJob(job)

    expect(job.status).toBe('released')
    expect(job.settlement.release).toContain('demo-release')
  })

  it('keeps AI revision recommendations from releasing funds', async () => {
    const job = submittedTask('I did the work, please release.')

    const review = await assessJobWithAi(job, aiReply({
      score: 35,
      recommendation: 'revision',
      summary: 'Submission does not show the acceptance items.',
      checks: [{ label: 'Delivery evidence', status: 'fail', reason: 'Notes are only a claim.', evidence: 'submission notes' }],
      missing: ['preview evidence', 'mobile proof'],
      risks: [],
    }))

    expect(review.approved).toBe(false)
    expect(job.status).toBe('submitted')
    expect(() => approveReviewedJob(job)).toThrow(/does not recommend/)

    requestRevisionJob(job, {})

    expect(job.status).toBe('revision_requested')
  })

  it('fails closed when AI review is unavailable or unreadable', async () => {
    const job = submittedTask()

    const review = await assessJobWithAi(job, async () => 'not json')

    expect(review.source).toBe('fallback')
    expect(review.approved).toBe(false)
    expect(job.status).toBe('submitted')
    expect(() => approveReviewedJob(job)).toThrow(/does not recommend/)
  })

  it('does not release keyword-stuffed submissions through AI review', async () => {
    const job = submittedTask('Responsive marketplace task card budget scope mobile proof preview URL repo link acceptance item delivery proof. Responsive marketplace task card budget scope mobile proof.')

    const review = await assessJobWithAi(job, aiReply({
      score: 28,
      recommendation: 'revision',
      summary: 'The notes repeat terms but do not demonstrate completed work.',
      checks: [{ label: 'Actual evidence', status: 'fail', reason: 'Keyword stuffing without concrete proof.', evidence: 'submission notes' }],
      missing: ['specific implementation proof'],
      risks: ['keyword stuffing'],
    }))

    expect(review.risks).toContain('keyword stuffing')
    expect(job.status).toBe('submitted')
    expect(() => approveReviewedJob(job)).toThrow(/does not recommend/)
  })

  it('blocks invalid transitions after release', () => {
    const job = platformJob()
    submitJob(job, {
      repo: 'https://example.test/repo',
      notes: 'Responsive checkout includes pricing, accessible buttons, mobile proof, deployment notes, preview URL, and repo link.',
    })
    reviewJob(job)

    expect(() => refundJob(job)).toThrow(/cannot refund a released job/)
    expect(() => cancelJob(job)).toThrow(/cannot cancel a released job/)
    expect(() => submitJob(job, { notes: 'late evidence' })).toThrow(/cannot submit evidence/)
  })

  it('disputes and refunds without allowing cancelled-job mutations', () => {
    const disputed = platformJob()
    disputeJob(disputed, { by: 'worker', note: 'Scope changed after funding' })
    expect(disputed.status).toBe('disputed')
    expect(disputed.disputes[0].by).toBe('worker')
    refundJob(disputed)
    expect(disputed.status).toBe('refunded')

    const cancelled = platformJob()
    cancelJob(cancelled)
    expect(cancelled.status).toBe('cancelled')
    expect(() => completeMilestone(cancelled, cancelled.milestones[0].id)).toThrow(/cannot complete milestones/)
  })
})
