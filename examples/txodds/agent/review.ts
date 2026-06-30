import { complete, parseJsonReply, type CompleteOpts } from '@pay/agent-runtime'

export interface ReviewMessage {
  author: 'employer' | 'worker' | 'agent'
  text: string
  at?: string
}

export interface DeliverySubmission {
  url?: string
  repo?: string
  notes?: string
}

export interface ReviewInput {
  title: string
  requirements: string
  acceptanceCriteria?: string
  messages: ReviewMessage[]
  submission?: DeliverySubmission
}

export interface ReviewCriterion {
  text: string
  score: number
  verdict: 'pass' | 'partial' | 'fail'
  evidence: string
  missing: string
}

export interface ReviewResult {
  approved: boolean
  score: number
  confidence: number
  summary: string
  missing: string[]
  releaseReason: string
  criteria: ReviewCriterion[]
}

type Llm = (opts: CompleteOpts) => Promise<string>

const STOPWORDS = new Set([
  'able', 'about', 'after', 'also', 'and', 'are', 'build', 'can', 'for', 'from', 'have', 'into',
  'must', 'need', 'needs', 'that', 'the', 'this', 'with', 'work', 'will', 'your', 'present',
  'works',
])

const hasLlmKey = (): boolean =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.VENICE_API_KEY)

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

const clean = (text: string): string => text.replace(/\s+/g, ' ').replace(/[.;:]+$/, '').trim()

export function deriveCriteria(input: Pick<ReviewInput, 'requirements' | 'acceptanceCriteria'>): string[] {
  const text = [input.requirements, input.acceptanceCriteria].filter(Boolean).join('\n')
  const parts = text
    .split(/\r?\n|[.;]\s+/)
    .map(clean)
    .filter((part) => part.length >= 8)
  const unique: string[] = []
  for (const part of parts) {
    const key = part.toLowerCase()
    if (!unique.some((x) => x.toLowerCase() === key)) unique.push(part)
  }
  return unique.slice(0, 8)
}

export function buildReviewPrompt(input: ReviewInput): CompleteOpts {
  const criteria = deriveCriteria(input)
  const transcript = input.messages
    .map((m) => `${m.author}${m.at ? ` at ${m.at}` : ''}: ${m.text}`)
    .join('\n') || '(no chat messages)'

  return {
    system:
      'You are a neutral freelance escrow agent. Review submitted delivery evidence against explicit criteria. ' +
      'Return only JSON: {approved:boolean, score:number, confidence:number, summary:string, missing:string[], ' +
      'releaseReason:string, criteria:[{text:string, score:number, verdict:"pass"|"partial"|"fail", evidence:string, missing:string}]}. ' +
      'Use only the provided task, chat transcript, and submission text as evidence. Do not claim you cloned repos, ran builds, or inspected URLs.',
    user: JSON.stringify({
      task: {
        title: input.title,
        requirements: input.requirements,
        acceptanceCriteria: input.acceptanceCriteria || '',
      },
      criteria,
      chatTranscript: transcript,
      submission: input.submission || {},
    }, null, 2),
    maxTokens: 700,
  }
}

const words = (text: string): string[] =>
  [...new Set((text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || [])
    .filter((w) => w.length > 3 && !STOPWORDS.has(w)))]

function submissionText(input: ReviewInput): string {
  const s = input.submission
  return [s?.url, s?.repo, s?.notes].filter(Boolean).join('\n')
}

function scoreCriterion(criterion: string, evidence: string): ReviewCriterion {
  const terms = words(criterion)
  const matched = terms.filter((term) => evidence.includes(term))
  const score = terms.length ? Math.round((matched.length / terms.length) * 100) : 0
  const verdict: ReviewCriterion['verdict'] = score >= 75 ? 'pass' : score >= 40 ? 'partial' : 'fail'
  const missingTerms = terms.filter((term) => !evidence.includes(term)).slice(0, 6)
  return {
    text: criterion,
    score,
    verdict,
    evidence: matched.length ? `Matched evidence terms: ${matched.join(', ')}` : '',
    missing: missingTerms.length ? `Missing evidence for: ${missingTerms.join(', ')}` : '',
  }
}

export function deterministicReview(input: ReviewInput): ReviewResult {
  const criteria = deriveCriteria(input)
  const submitted = submissionText(input).trim()
  if (!criteria.length || !submitted) {
    return {
      approved: false,
      score: 0,
      confidence: 0.8,
      summary: 'Manual/demo review: requirements and submitted evidence are both required before release.',
      missing: !criteria.length ? ['requirements'] : ['submitted deliverable'],
      releaseReason: 'No release: the review evidence is incomplete.',
      criteria: criteria.map((text) => ({ text, score: 0, verdict: 'fail', evidence: '', missing: 'No submitted evidence.' })),
    }
  }

  const evidence = [submitted, ...input.messages.map((m) => m.text)].join('\n').toLowerCase()
  const scored = criteria.map((criterion) => scoreCriterion(criterion, evidence))
  const score = Math.round(scored.reduce((sum, item) => sum + item.score, 0) / scored.length)
  const missing = scored.filter((item) => item.verdict !== 'pass').map((item) => item.text)
  const approved = score >= 70 && scored.every((item) => item.verdict !== 'fail')

  return {
    approved,
    score,
    confidence: approved ? 0.68 : 0.74,
    summary: `Manual/demo rubric review: ${scored.filter((item) => item.verdict === 'pass').length} of ${scored.length} criteria passed.`,
    missing,
    releaseReason: approved
      ? 'Release recommended by deterministic rubric review; human verification is still advised for production.'
      : 'No release: one or more criteria lack enough submitted evidence.',
    criteria: scored,
  }
}

function normalizeCriterion(value: unknown, fallbackText = 'Unspecified criterion'): ReviewCriterion {
  const c = (value || {}) as Partial<ReviewCriterion>
  const score = clamp(Math.round(Number(c.score)), 0, 100)
  const verdict = c.verdict === 'pass' || c.verdict === 'partial' || c.verdict === 'fail'
    ? c.verdict
    : score >= 75 ? 'pass' : score >= 40 ? 'partial' : 'fail'
  return {
    text: typeof c.text === 'string' && c.text.trim() ? clean(c.text) : fallbackText,
    score: Number.isFinite(score) ? score : 0,
    verdict,
    evidence: typeof c.evidence === 'string' ? clean(c.evidence) : '',
    missing: typeof c.missing === 'string' ? clean(c.missing) : '',
  }
}

function normalizeReview(value: unknown, fallbackCriteria: string[]): ReviewResult | null {
  const r = value as Partial<ReviewResult> | null
  if (!r || typeof r !== 'object' || typeof r.approved !== 'boolean') return null
  const criteria = Array.isArray(r.criteria) && r.criteria.length
    ? r.criteria.map((item, i) => normalizeCriterion(item, fallbackCriteria[i] || `Criterion ${i + 1}`))
    : fallbackCriteria.map((text) => normalizeCriterion({ text, score: r.approved ? 80 : 30 }, text))
  const score = Number.isFinite(Number(r.score))
    ? clamp(Math.round(Number(r.score)), 0, 100)
    : Math.round(criteria.reduce((sum, item) => sum + item.score, 0) / Math.max(1, criteria.length))
  const missing = Array.isArray(r.missing)
    ? r.missing.map(String).filter(Boolean)
    : criteria.filter((item) => item.verdict !== 'pass').map((item) => item.text)
  return {
    approved: r.approved,
    score,
    confidence: clamp(Number(r.confidence), 0, 1) || (r.approved ? 0.75 : 0.65),
    summary: typeof r.summary === 'string' && r.summary.trim() ? clean(r.summary) : 'Escrow agent rubric review completed.',
    missing,
    releaseReason: typeof r.releaseReason === 'string' && r.releaseReason.trim()
      ? clean(r.releaseReason)
      : (r.approved ? 'Criteria are sufficiently satisfied by the submitted evidence.' : 'Criteria are not sufficiently satisfied.'),
    criteria,
  }
}

export async function reviewDelivery(input: ReviewInput, llm?: Llm): Promise<ReviewResult> {
  const criteria = deriveCriteria(input)
  const runLlm = llm ?? (hasLlmKey() ? complete : undefined)
  if (runLlm) {
    try {
      const raw = await runLlm(buildReviewPrompt(input))
      const parsed = parseJsonReply(raw)
      const normalized = normalizeReview(parsed, criteria)
      if (normalized) return normalized
    } catch {
      /* LLM unavailable or malformed -> deterministic fallback below. */
    }
  }
  return deterministicReview(input)
}
