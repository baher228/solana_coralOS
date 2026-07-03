import { formatBid, parseWant, type Delivered } from '@pay/agent-runtime/src/market/protocol.ts'

export interface DemoJob {
  id: string
  title: string
  scope: string
  acceptanceCriteria: string
}

export interface DemoWant {
  round: number
  budgetSol: number
  job: DemoJob
}

export interface ApiAgentJob extends DemoJob {
  amountSol: number
  status: string
  marketplace?: {
    round?: number
    bids?: Array<{ by: string }>
    awardedBid?: { by: string }
  }
}

export interface DeliveryOptions {
  url: string
  repo?: string
  notes: string
}

export type Completion = (opts: { system: string; user: string; maxTokens?: number }) => Promise<string>

export function parseFreelanceWant(text: string): DemoWant | null {
  const want = parseWant(text)
  if (!want || want.service !== 'freelance') return null
  try {
    const data = JSON.parse(want.arg) as Partial<DemoJob>
    if (!data.id || !data.title) return null
    return {
      round: want.round,
      budgetSol: want.budgetSol,
      job: {
        id: String(data.id),
        title: String(data.title),
        scope: String(data.scope || ''),
        acceptanceCriteria: String(data.acceptanceCriteria || ''),
      },
    }
  } catch {
    return null
  }
}

export function chooseBidPrice(budgetSol: number, configured?: string): number {
  if (!Number.isFinite(budgetSol) || budgetSol <= 0) throw new Error('WANT budget must be positive')
  const requested = Number(configured)
  const price = Number.isFinite(requested) && requested > 0 ? requested : budgetSol * 0.8
  return Number(Math.min(price, budgetSol).toFixed(6))
}

export function bidMessage(input: { round: number; priceSol: number; by: string; wallet: string }): string {
  return formatBid({ ...input, note: 'demo-worker-ready' })
}

export function hasAgentBid(job: ApiAgentJob, agentName: string): boolean {
  return Boolean(job.marketplace?.bids?.some((bid) => bid.by === agentName))
}

export function isAwardedToAgent(job: ApiAgentJob, agentName: string): boolean {
  return job.marketplace?.awardedBid?.by === agentName
}

export function apiBidPayload(job: ApiAgentJob, agentName: string, wallet?: string, configuredPrice?: string): Record<string, unknown> {
  return {
    round: job.marketplace?.round || 1,
    priceSol: chooseBidPrice(job.amountSol, configuredPrice),
    note: `${agentName}-ready`,
    ...(wallet ? { wallet } : {}),
  }
}

export function fallbackNotes(job: DemoJob): string {
  return [
    `Demo worker completed "${job.title}".`,
    job.scope ? `Scope addressed: ${job.scope}` : '',
    job.acceptanceCriteria ? `Acceptance evidence: ${job.acceptanceCriteria}` : '',
    'Attached preview demonstrates the requested delivery for marketplace review.',
  ].filter(Boolean).join(' ')
}

export async function deliveryNotes(job: DemoJob, preset?: string, complete?: Completion): Promise<string> {
  if (preset?.trim()) return preset.trim()
  if (!complete) return fallbackNotes(job)
  try {
    const text = await complete({
      system: 'You write concise freelance delivery notes for escrow review. Return plain text only.',
      user: JSON.stringify({
        title: job.title,
        scope: job.scope,
        acceptanceCriteria: job.acceptanceCriteria,
        instruction: 'Write 2-4 specific sentences explaining what was delivered and what evidence is attached.',
      }),
      maxTokens: 240,
    })
    return text.trim() || fallbackNotes(job)
  } catch {
    return fallbackNotes(job)
  }
}

export function deliveryPayload(round: number, opts: DeliveryOptions): Delivered {
  return {
    round,
    url: opts.url,
    ...(opts.repo ? { repo: opts.repo } : {}),
    notes: opts.notes,
  }
}
