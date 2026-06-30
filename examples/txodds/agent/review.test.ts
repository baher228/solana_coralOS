import { describe, expect, it } from 'vitest'
import { buildReviewPrompt, deriveCriteria, reviewDelivery } from './review.js'

const base = {
  title: 'Checkout landing page',
  requirements: 'Create a responsive landing page with pricing cards and a contact form.',
  acceptanceCriteria: 'Mobile layout works. Contact form and pricing cards are present.',
  messages: [
    { author: 'employer' as const, text: 'Please make sure the mobile layout is clean.' },
    { author: 'worker' as const, text: 'I added responsive pricing cards.' },
  ],
}

describe('reviewDelivery', () => {
  it('derives criteria from requirements and acceptance criteria', () => {
    expect(deriveCriteria(base)).toEqual([
      'Create a responsive landing page with pricing cards and a contact form',
      'Mobile layout works',
      'Contact form and pricing cards are present',
    ])
  })

  it('approves when the submission clearly matches the requirements', async () => {
    const review = await reviewDelivery({
      ...base,
      submission: { url: 'https://example.test', notes: 'Responsive landing page with pricing cards, mobile layout, and contact form is complete.' },
    })
    expect(review.approved).toBe(true)
    expect(review.score).toBeGreaterThanOrEqual(60)
    expect(review.confidence).toBeGreaterThan(0)
    expect(review.criteria.length).toBeGreaterThan(1)
    expect(review.criteria.every((criterion) => criterion.verdict === 'pass')).toBe(true)
    expect(review.summary).toMatch(/Manual\/demo rubric review/)
  })

  it('rejects when the deliverable is empty or misses the stated requirements', async () => {
    const empty = await reviewDelivery({ ...base, submission: { notes: '' } })
    expect(empty.approved).toBe(false)
    expect(empty.missing).toContain('submitted deliverable')
    expect(empty.criteria.every((criterion) => criterion.verdict === 'fail')).toBe(true)

    const miss = await reviewDelivery({ ...base, submission: { notes: 'I changed the header color.' } })
    expect(miss.approved).toBe(false)
    expect(miss.missing.length).toBeGreaterThan(0)
    expect(miss.criteria.some((criterion) => criterion.verdict === 'fail')).toBe(true)
  })

  it('includes the chat transcript in the LLM review input', () => {
    const prompt = buildReviewPrompt({
      ...base,
      submission: { repo: 'https://github.com/example/site', notes: 'Ready for review.' },
    })
    expect(prompt.user).toContain('Please make sure the mobile layout is clean.')
    expect(prompt.user).toContain('I added responsive pricing cards.')
    expect(prompt.user).toContain('https://github.com/example/site')
    expect(prompt.user).toContain('criteria')
    expect(prompt.system).toContain('criteria')
  })

  it('normalizes LLM rubric output', async () => {
    const review = await reviewDelivery({
      ...base,
      submission: { notes: 'Responsive landing page with pricing cards, mobile layout, and contact form.' },
    }, async () => JSON.stringify({
      approved: true,
      score: 88,
      confidence: 0.77,
      summary: 'Criteria satisfied.',
      missing: [],
      releaseReason: 'All key items are evidenced.',
      criteria: [{ text: 'Mobile layout works', score: 90, verdict: 'pass', evidence: 'mobile layout', missing: '' }],
    }))
    expect(review.approved).toBe(true)
    expect(review.confidence).toBe(0.77)
    expect(review.criteria[0].verdict).toBe('pass')
  })
})
