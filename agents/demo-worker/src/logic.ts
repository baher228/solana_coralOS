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

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

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

export function matchesTargetJob(job: ApiAgentJob, targetJobId?: string): boolean {
  return !targetJobId || job.id === targetJobId
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

export function generatedDeliveryHtml(job: DemoJob, agentName = 'demo-worker'): string {
  const criteria = job.acceptanceCriteria
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean)
  const items = (criteria.length ? criteria : [
    'Responsive preview URL',
    'Clear delivery notes',
    'Mobile-ready layout',
  ]).slice(0, 6)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(job.title)} - Agent Delivery</title>
  <style>
    :root {
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #232620;
      background: #eef2e9;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef2e9; }
    main {
      min-height: 100vh;
      display: grid;
      align-content: center;
      gap: 24px;
      padding: clamp(24px, 6vw, 72px);
    }
    .hero, .proof {
      border: 1px solid #cfd8c6;
      border-radius: 8px;
      background: #fffdf8;
      box-shadow: 0 18px 50px rgba(35, 38, 32, .12);
    }
    .hero { padding: clamp(24px, 5vw, 48px); }
    .eyebrow {
      margin: 0 0 14px;
      color: #718064;
      font-size: 13px;
      font-weight: 900;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    h1 {
      max-width: 820px;
      margin: 0;
      font-size: clamp(34px, 7vw, 72px);
      line-height: .95;
      letter-spacing: 0;
    }
    .scope {
      max-width: 760px;
      margin: 18px 0 0;
      color: #596054;
      font-size: clamp(17px, 2.5vw, 22px);
      line-height: 1.45;
    }
    .proof {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1px;
      overflow: hidden;
      background: #cfd8c6;
    }
    .proof div {
      min-height: 132px;
      padding: 20px;
      background: #fbf8f0;
    }
    .proof span {
      display: block;
      color: #8b6e43;
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
    }
    .proof b {
      display: block;
      margin-top: 9px;
      color: #232620;
      font-size: 18px;
      line-height: 1.25;
    }
    footer {
      color: #68725f;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <p class="eyebrow">Built by ${escapeHtml(agentName)}</p>
      <h1>${escapeHtml(job.title)}</h1>
      <p class="scope">${escapeHtml(job.scope || 'Generated delivery preview for marketplace review.')}</p>
    </section>
    <section class="proof">
      ${items.map((item, index) => `<div><span>Acceptance ${index + 1}</span><b>${escapeHtml(item)}</b></div>`).join('')}
    </section>
    <footer>Generated locally by the demo worker agent for job ${escapeHtml(job.id)}.</footer>
  </main>
</body>
</html>`
}
