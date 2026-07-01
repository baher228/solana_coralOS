import { describe, expect, it } from 'vitest'
import { createJob, reviewJob } from './proxy.js'

describe('freelance escrow flow', () => {
  it('creates a job and releases after sufficient evidence', () => {
    const job = createJob({
      title: 'Build checkout',
      requirements: 'Responsive checkout with pricing and accessible buttons',
      acceptanceCriteria: 'Preview URL, repo link, mobile proof, and deployment notes',
      amountSol: 0.001,
    })
    job.submission = {
      at: new Date().toISOString(),
      url: 'https://example.test/preview',
      repo: 'https://example.test/repo',
      notes: 'Responsive checkout includes pricing, accessible buttons, mobile proof, deployment notes, preview URL, and repo link.',
    }
    const review = reviewJob(job)
    expect(review.approved).toBe(true)
    expect(job.status).toBe('released')
    expect(job.settlement.release).toContain('demo-release')
  })
})
