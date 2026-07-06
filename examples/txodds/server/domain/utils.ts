import { createHash } from 'node:crypto'
import bs58 from 'bs58'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { AUTO_RELEASE_MS, BALANCE_TIMEOUT_MS, DEFAULT_RPC_URL, ESCROW_DEADLINE_SECS } from '../config.js'
import type { Actor, Dispute, Job, Milestone, SettlementEventType, Status } from '../types.js'

export const terminal = new Set<Status>(['released', 'refunded', 'cancelled'])
export const statuses = new Set<Status>(['open', 'funded', 'submitted', 'approved', 'released', 'revision_requested', 'disputed', 'refunded', 'cancelled'])

export function keypair(key: string): Keypair | null {
  const raw = process.env[key]?.trim()
  if (!raw) return null
  try { return Keypair.fromSecretKey(bs58.decode(raw)) } catch { return null }
}

export function publicKey(input: unknown): PublicKey | null {
  try {
    const text = String(input || '').trim()
    return text ? new PublicKey(text) : null
  } catch {
    return null
  }
}

export function wallets() {
  const employer = keypair('BUYER_KEYPAIR_B58')?.publicKey.toBase58()
  const worker = keypair('SELLER_KEYPAIR_B58')?.publicKey.toBase58() || process.env.WALLET || ''
  return { employer, worker, configured: Boolean(employer && worker) }
}

async function solBalance(connection: Connection, address?: string): Promise<number | null> {
  if (!address) return null
  try {
    const lamports = await Promise.race([
      connection.getBalance(new PublicKey(address), 'confirmed'),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), BALANCE_TIMEOUT_MS)),
    ])
    return typeof lamports === 'number' ? Number((lamports / LAMPORTS_PER_SOL).toFixed(9)) : null
  } catch {
    return null
  }
}

export async function walletsWithBalances() {
  const w = wallets()
  const connection = new Connection(process.env.SOLANA_RPC_URL || DEFAULT_RPC_URL, 'confirmed')
  const [employerSol, workerSol] = await Promise.all([
    solBalance(connection, w.employer),
    solBalance(connection, w.worker),
  ])
  return { ...w, balances: { employerSol, workerSol } }
}

export function referenceFor(input: string): string {
  return new PublicKey(createHash('sha256').update(input).digest()).toBase58()
}

export function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status })
}

export function now() {
  return new Date().toISOString()
}

export function deadlineFrom(at: string, ms = AUTO_RELEASE_MS) {
  return new Date(new Date(at).getTime() + ms).toISOString()
}

export function deadlineFromNowSecs(secs = ESCROW_DEADLINE_SECS) {
  return new Date(Date.now() + secs * 1000).toISOString()
}

export function activeDispute(job: Job): Dispute | undefined {
  return job.disputes.find((dispute) => dispute.status === 'open')
}

export function addEvent(job: Job, actor: Actor, type: string, summary: string) {
  job.events.unshift({ at: now(), actor, type, summary })
}

export function addSettlementEvent(job: Job, type: SettlementEventType, summary: string) {
  job.settlement.events.unshift({ at: now(), type, summary })
}

export function ensureNotTerminal(job: Job, action: string) {
  if (terminal.has(job.status)) fail(`cannot ${action} a ${job.status} job`, 409)
}

export function ensureStatus(job: Job, allowed: Status[], action: string) {
  ensureNotTerminal(job, action)
  if (!allowed.includes(job.status)) fail(`cannot ${action} while job is ${job.status}`, 409)
}

export function participantName(input: unknown, fallback: string): string {
  const value = String(input || '').trim()
  return value || fallback
}

export function makeMilestones(input: unknown, amountSol: number, scope: string, criteria: string): Milestone[] {
  const fromArray = Array.isArray(input)
    ? input
      .map((item) => typeof item === 'string' ? item : (item as { title?: unknown; description?: unknown })?.title ?? '')
      .map((item) => String(item).trim())
      .filter(Boolean)
    : []
  const fromText = typeof input === 'string'
    ? input.split(/\r?\n|;/).map((item) => item.trim()).filter(Boolean)
    : []
  const titles = (fromArray.length ? fromArray : fromText).slice(0, 8)
  const chosen = titles.length ? titles : [
    'Scope and terms accepted',
    'Delivery evidence submitted',
    'Review and settlement completed',
  ]
  const share = Number((amountSol / chosen.length).toFixed(6))
  return chosen.map((title, i) => ({
    id: `ms_${i + 1}`,
    title,
    description: i === 0 ? scope : i === chosen.length - 1 ? criteria : '',
    amountSol: i === chosen.length - 1 ? Number((amountSol - share * (chosen.length - 1)).toFixed(6)) : share,
    status: 'pending',
  }))
}

export function normalizeBody(input: Record<string, unknown>) {
  const amountSol = Math.max(0.001, Number(input.amountSol) || 0.001)
  const scope = String(input.scope || input.requirements || '').trim()
  const acceptanceCriteria = String(input.acceptanceCriteria || '').trim()
  const worker = String(input.worker || '').trim()
  const employer = participantName(input.employer, wallets().employer || 'Employer')
  const openTask = !worker && (input.marketplace === true || input.workflow === 'marketplace' || Boolean(String(input.employer || '').trim()))
  return {
    title: String(input.title || '').trim() || 'Untitled freelance task',
    employer,
    worker: openTask ? '' : participantName(input.worker, wallets().worker || 'Worker'),
    openTask,
    scope,
    requirements: scope,
    acceptanceCriteria,
    amountSol,
    milestones: makeMilestones(input.milestones, amountSol, scope, acceptanceCriteria),
  }
}
