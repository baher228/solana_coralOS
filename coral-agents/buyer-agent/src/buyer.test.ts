import { describe, it, expect } from 'vitest'
import { guardPayment, type PurchaseGuard } from './guard.js'
import { parse402 } from './llm_buyer.js'
import { payFromUrl } from './wallet.js'

const RECIP = '7jwB6M2DtuDuXJvFT9RiEwDQUX6Q3DhwtDwg3v8DpjZw'
const fresh = (): PurchaseGuard => ({
  allowedRecipients: new Set(),
  allowedReferences: new Set(),
  spentLamports: 0,
})

describe('guardPayment — code-enforced trust (not prompt-enforced)', () => {
  it('refuses a recipient that never appeared in a challenge (prompt-injection defense, H2)', () => {
    const r = guardPayment(fresh(), { recipient: 'AttackerWa11et', amountSol: 0.0001 }, 1e9)
    expect(r.allowed).toBe(false)
  })

  it('allows a recipient seen in a real challenge, within budget', () => {
    const g = fresh()
    g.allowedRecipients.add(RECIP)
    const r = guardPayment(g, { recipient: RECIP, amountSol: 0.0001 }, 1e9)
    expect(r.allowed).toBe(true)
  })

  it('refuses a reference not seen in a challenge', () => {
    const g = fresh()
    g.allowedRecipients.add(RECIP)
    const r = guardPayment(g, { recipient: RECIP, amountSol: 0.0001, reference: 'bogus-ref' }, 1e9)
    expect(r.allowed).toBe(false)
  })

  it('enforces the cumulative budget across the loop (M3)', () => {
    const g = fresh()
    g.allowedRecipients.add(RECIP)
    g.spentLamports = 900_000 // already spent this loop
    const r = guardPayment(g, { recipient: RECIP, amountSol: 0.001 }, 1_000_000) // 0.001 SOL would push over
    expect(r.allowed).toBe(false)
    if (!r.allowed) expect(r.reason).toMatch(/budget/i)
  })
})

describe('parse402', () => {
  it('parses a JSON payment challenge from the body', () => {
    const c = parse402(new Headers(), JSON.stringify({ recipient: RECIP, amountSol: 0.0001, reference: 'R' }))
    expect(c?.recipient).toBe(RECIP)
    expect(c?.amountSol).toBe(0.0001)
  })

  it('returns null for non-challenges', () => {
    expect(parse402(new Headers(), 'not json')).toBeNull()
    expect(parse402(new Headers())).toBeNull()
  })
})

describe('payFromUrl — budget enforcement (before any signing)', () => {
  it('throws when the amount exceeds the budget', async () => {
    await expect(payFromUrl(`solana:${RECIP}?amount=1&reference=R`, 0.001)).rejects.toThrow(/budget/i)
  })

  it('throws on an invalid amount', async () => {
    await expect(payFromUrl(`solana:${RECIP}?amount=0`, 1)).rejects.toThrow(/amount/i)
  })
})
