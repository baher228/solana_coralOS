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

function artifactRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'review_test',
    at: new Date().toISOString(),
    repo: { status: 'pass', summary: 'Repository cloned and scanned', url: 'https://github.com/example/repo', commit: 'abc123', packageManager: 'npm', scripts: { build: 'vite build' }, files: [] },
    build: { status: 'pass', summary: 'Build completed', command: 'npm run build', outputDir: 'dist' },
    preview: { status: 'pass', summary: 'Preview URL loaded', url: 'https://example.test/preview', httpStatus: 200 },
    screenshots: [
      { id: 'shot_desktop', kind: 'screenshot', label: 'preview desktop', file: 'job/review/desktop.png', mime: 'image/png' },
      { id: 'shot_mobile', kind: 'screenshot', label: 'preview mobile', file: 'job/review/mobile.png', mime: 'image/png' },
    ],
    logs: [],
    ...overrides,
  } as any
}

function collectArtifacts(run = artifactRun()) {
  return async () => run
}

function aiApprove(extra: Record<string, unknown> = {}) {
  return aiReply({
    score: 92,
    recommendation: 'approve',
    confidence: 88,
    summary: 'Evidence satisfies the task.',
    criteriaResults: [
      { label: 'Preview URL', status: 'pass', reason: 'Preview loaded and screenshots were captured.', evidence: 'preview desktop/mobile screenshots' },
      { label: 'Mobile proof', status: 'pass', reason: 'Mobile screenshot shows responsive layout.', evidence: 'preview mobile screenshot' },
    ],
    missing: [],
    risks: [],
    criticalRisks: [],
    revisionInstructions: '',
    ...extra,
  })
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

  it('stores artifact AI approval without auto-releasing until employer approves', async () => {
    const job = submittedTask()

    const review = await assessJobWithAi(job, aiApprove(), collectArtifacts())

    expect(review.source).toBe('ai')
    expect(review.approved).toBe(true)
    expect(review.releaseEligible).toBe(true)
    expect(review.artifactRun?.screenshots).toHaveLength(2)
    expect(job.status).toBe('submitted')
    expect(job.settlement.release).toBeUndefined()

    approveReviewedJob(job)

    expect(job.status).toBe('released')
    expect(job.settlement.release).toContain('demo-release')
  })

  it('blocks release when AI approves but a criterion is unclear', async () => {
    const job = submittedTask()

    const review = await assessJobWithAi(job, aiApprove({
      criteriaResults: [
        { label: 'Preview URL', status: 'pass', reason: 'Preview loaded.', evidence: 'preview screenshot' },
        { label: 'Mobile proof', status: 'unclear', reason: 'Mobile screenshot does not show the checkout section.', evidence: 'mobile screenshot' },
      ],
    }), collectArtifacts())

    expect(review.releaseEligible).toBe(false)
    expect(review.missing.join(' ')).toMatch(/Mobile proof is unclear/)
    expect(() => approveReviewedJob(job)).toThrow(/review gates/)
  })

  it('blocks release when the submitted project build fails', async () => {
    const job = submittedTask()

    const review = await assessJobWithAi(job, aiApprove(), collectArtifacts(artifactRun({
      build: { status: 'fail', summary: 'Build failed', command: 'npm run build', log: 'missing script' },
    })))

    expect(review.releaseEligible).toBe(false)
    expect(review.missing.join(' ')).toMatch(/build/i)
    expect(() => approveReviewedJob(job)).toThrow(/review gates/)
  })

  it('blocks release when visual work has no screenshots', async () => {
    const job = submittedTask()

    const review = await assessJobWithAi(job, aiApprove(), collectArtifacts(artifactRun({ screenshots: [] })))

    expect(review.releaseEligible).toBe(false)
    expect(review.missing.join(' ')).toMatch(/screenshots/i)
  })

  it('blocks release when the preview cannot be inspected', async () => {
    const job = submittedTask()

    const review = await assessJobWithAi(job, aiApprove(), collectArtifacts(artifactRun({
      preview: { status: 'fail', summary: 'Preview URL failed to load', url: 'https://example.test/preview', error: 'timeout' },
    })))

    expect(review.releaseEligible).toBe(false)
    expect(review.missing.join(' ')).toMatch(/Preview URL/)
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
    }), collectArtifacts())

    expect(review.approved).toBe(false)
    expect(job.status).toBe('submitted')
    expect(() => approveReviewedJob(job)).toThrow(/review gates/)

    requestRevisionJob(job, {})

    expect(job.status).toBe('revision_requested')
  })

  it('fails closed when AI review is unavailable or unreadable', async () => {
    const job = submittedTask()

    const review = await assessJobWithAi(job, async () => 'not json', collectArtifacts())

    expect(review.source).toBe('fallback')
    expect(review.approved).toBe(false)
    expect(job.status).toBe('submitted')
    expect(() => approveReviewedJob(job)).toThrow(/review gates/)
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
    }), collectArtifacts())

    expect(review.risks).toContain('keyword stuffing')
    expect(job.status).toBe('submitted')
    expect(() => approveReviewedJob(job)).toThrow(/review gates/)
  })

  it('blocks release while a dispute is active', async () => {
    const job = submittedTask()
    await assessJobWithAi(job, aiApprove(), collectArtifacts())
    disputeJob(job, { by: 'worker', note: 'Evidence is contested' })

    expect(() => approveReviewedJob(job)).toThrow(/cannot approve while job is disputed/)
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
