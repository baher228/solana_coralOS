/**
 * Market protocol: pure string formatters/parsers for lightweight buyer/seller coordination.
 */

export interface Want {
  round: number
  service: string
  arg: string
  budgetSol: number
}

export interface Bid {
  round: number
  priceSol: number
  by: string
  wallet: string
  note?: string
}

export interface EscrowTerms {
  round: number
  reference: string
  seller: string
  amountSol: number
  deadlineSecs: number
}

export interface Deposited {
  round: number
  reference: string
  buyer: string
  sig: string
}

export interface Delivered {
  round: number
  url?: string
  repo?: string
  notes?: string
  evidenceUrls?: string[]
  photoUrls?: string[]
  videoUrls?: string[]
}

export interface Settled {
  round: number
  reference: string
  sig: string
}

export interface ReviewRequest {
  round: number
  jobId: string
  payload: Record<string, unknown>
}

export interface ReviewOpinion {
  round: number
  role: 'worker' | 'employer'
  payload: Record<string, unknown>
}

export interface ReviewVerdict {
  round: number
  payload: Record<string, unknown>
}

const num = (text: string, key: string): number | undefined => {
  const m = text.match(new RegExp(`${key}=([\\d.]+)`))
  return m ? Number(m[1]) : undefined
}
const tok = (text: string, key: string): string | undefined =>
  text.match(new RegExp(`${key}=(\\S+)`))?.[1]
const enc = (value: string): string => encodeURIComponent(value)
const dec = (value: string): string => {
  try { return decodeURIComponent(value) } catch { return value }
}
const jsonPayload = (text: string): Record<string, unknown> | null => {
  const start = text.indexOf('{')
  if (start < 0) return null
  try {
    const data = JSON.parse(text.slice(start))
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null
  } catch {
    return null
  }
}

export function verb(text: string): string {
  return text.trim().split(/\s+/)[0]?.toUpperCase() ?? ''
}

export function messageRound(text: string): number | undefined {
  return num(text, 'round')
}

export function formatWant(w: Want): string {
  return `WANT round=${w.round} service=${w.service} arg=${enc(w.arg)} budget=${w.budgetSol}`
}

export function parseWant(text: string): Want | null {
  if (verb(text) !== 'WANT') return null
  const round = num(text, 'round')
  const service = tok(text, 'service')
  const arg = tok(text, 'arg')
  const budgetSol = num(text, 'budget')
  if (round == null || !service || arg == null || budgetSol == null) return null
  return { round, service, arg: dec(arg), budgetSol }
}

export function formatBid(b: Bid): string {
  const base = `BID round=${b.round} price=${b.priceSol} by=${b.by} wallet=${b.wallet}`
  return b.note ? `${base} note=${b.note}` : base
}

export function parseBid(text: string): Bid | null {
  if (verb(text) !== 'BID') return null
  const round = num(text, 'round')
  const priceSol = num(text, 'price')
  const by = tok(text, 'by')
  const wallet = tok(text, 'wallet')
  if (round == null || priceSol == null || !by || !wallet) return null
  const note = text.match(/note=(.+)$/)?.[1]?.trim()
  return { round, priceSol, by, wallet, ...(note ? { note } : {}) }
}

export function formatAward(round: number, to: string, reason?: string): string {
  const base = `AWARD round=${round} to=${to}`
  return reason ? `${base} reason="${reason.replace(/"/g, "'")}"` : base
}

export function parseAward(text: string): { round: number; to: string; reason?: string } | null {
  if (verb(text) !== 'AWARD') return null
  const round = num(text, 'round')
  const to = tok(text, 'to')
  if (round == null || !to) return null
  const reason = text.match(/reason="([^"]*)"/)?.[1]
  return { round, to, ...(reason ? { reason } : {}) }
}

export function formatEscrowRequired(t: EscrowTerms): string {
  return `ESCROW_REQUIRED round=${t.round} reference=${t.reference} seller=${t.seller} amount=${t.amountSol} deadline=${t.deadlineSecs}`
}

export function parseEscrowRequired(text: string): EscrowTerms | null {
  if (verb(text) !== 'ESCROW_REQUIRED') return null
  const round = num(text, 'round')
  const reference = tok(text, 'reference')
  const seller = tok(text, 'seller')
  const amountSol = num(text, 'amount')
  const deadlineSecs = num(text, 'deadline')
  if (round == null || !reference || !seller || amountSol == null || deadlineSecs == null) return null
  return { round, reference, seller, amountSol, deadlineSecs }
}

export function formatDeposited(d: Deposited): string {
  return `DEPOSITED round=${d.round} reference=${d.reference} buyer=${d.buyer} sig=${d.sig}`
}

export function parseDeposited(text: string): Deposited | null {
  if (verb(text) !== 'DEPOSITED') return null
  const round = num(text, 'round')
  const reference = tok(text, 'reference')
  const buyer = tok(text, 'buyer')
  const sig = tok(text, 'sig')
  if (round == null || !reference || !buyer || !sig) return null
  return { round, reference, buyer, sig }
}

export function formatDelivered(d: Delivered): string {
  const payload = JSON.stringify({
    ...(d.url ? { url: d.url } : {}),
    ...(d.repo ? { repo: d.repo } : {}),
    ...(d.notes ? { notes: d.notes } : {}),
    ...(d.evidenceUrls?.length ? { evidenceUrls: d.evidenceUrls } : {}),
    ...(d.photoUrls?.length ? { photoUrls: d.photoUrls } : {}),
    ...(d.videoUrls?.length ? { videoUrls: d.videoUrls } : {}),
  })
  return `DELIVERED round=${d.round} ${payload}`
}

export function parseDelivered(text: string): Delivered | null {
  if (verb(text) !== 'DELIVERED') return null
  const round = num(text, 'round')
  const start = text.indexOf('{')
  if (round == null || start < 0) return null
  try {
    const data = JSON.parse(text.slice(start)) as Record<string, unknown>
    const delivered: Delivered = {
      round,
      ...(data.url ? { url: String(data.url) } : {}),
      ...(data.repo ? { repo: String(data.repo) } : {}),
      ...(data.notes ? { notes: String(data.notes) } : {}),
      ...(Array.isArray(data.evidenceUrls) ? { evidenceUrls: data.evidenceUrls.map(String).filter(Boolean) } : {}),
      ...(Array.isArray(data.photoUrls) ? { photoUrls: data.photoUrls.map(String).filter(Boolean) } : {}),
      ...(Array.isArray(data.videoUrls) ? { videoUrls: data.videoUrls.map(String).filter(Boolean) } : {}),
    }
    return delivered.url || delivered.repo || delivered.notes || delivered.evidenceUrls?.length || delivered.photoUrls?.length || delivered.videoUrls?.length ? delivered : null
  } catch {
    return null
  }
}

export function formatReleased(s: Settled): string {
  return `RELEASED round=${s.round} reference=${s.reference} sig=${s.sig}`
}

export function parseReleased(text: string): Settled | null {
  if (verb(text) !== 'RELEASED') return null
  return parseSettled(text)
}

export function formatRefunded(s: Settled): string {
  return `REFUNDED round=${s.round} reference=${s.reference} sig=${s.sig}`
}

export function parseRefunded(text: string): Settled | null {
  if (verb(text) !== 'REFUNDED') return null
  return parseSettled(text)
}

export function formatReviewRequest(r: ReviewRequest): string {
  return `REVIEW_REQUEST round=${r.round} job=${r.jobId} ${JSON.stringify(r.payload)}`
}

export function parseReviewRequest(text: string): ReviewRequest | null {
  if (verb(text) !== 'REVIEW_REQUEST') return null
  const round = num(text, 'round')
  const jobId = tok(text, 'job')
  const payload = jsonPayload(text)
  if (round == null || !jobId || !payload) return null
  return { round, jobId, payload }
}

export function formatReviewOpinion(o: ReviewOpinion): string {
  return `REVIEW_OPINION round=${o.round} role=${o.role} ${JSON.stringify(o.payload)}`
}

export function parseReviewOpinion(text: string): ReviewOpinion | null {
  if (verb(text) !== 'REVIEW_OPINION') return null
  const round = num(text, 'round')
  const role = tok(text, 'role')
  const payload = jsonPayload(text)
  if (round == null || (role !== 'worker' && role !== 'employer') || !payload) return null
  return { round, role, payload }
}

export function formatReviewVerdict(v: ReviewVerdict): string {
  return `REVIEW_VERDICT round=${v.round} ${JSON.stringify(v.payload)}`
}

export function parseReviewVerdict(text: string): ReviewVerdict | null {
  if (verb(text) !== 'REVIEW_VERDICT') return null
  const round = num(text, 'round')
  const payload = jsonPayload(text)
  if (round == null || !payload) return null
  return { round, payload }
}

function parseSettled(text: string): Settled | null {
  const round = num(text, 'round')
  const reference = tok(text, 'reference')
  const sig = tok(text, 'sig')
  if (round == null || !reference || !sig) return null
  return { round, reference, sig }
}

export function selectBids(bids: Bid[], round: number): Bid[] {
  const bySeller = new Map<string, Bid>()
  for (const b of bids) if (b.round === round) bySeller.set(b.by, b)
  return [...bySeller.values()]
}

export function pickCheapest(bids: Bid[]): Bid | undefined {
  return [...bids].sort((a, b) => a.priceSol - b.priceSol)[0]
}
