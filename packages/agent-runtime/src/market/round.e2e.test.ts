/**
 * Protocol round e2e - drives a full WANT -> BID -> AWARD -> ESCROW_REQUIRED -> DEPOSITED -> DELIVERED ->
 * RELEASED conversation through the REAL wire format + selection, against an in-memory thread and a
 * fake escrow ledger. No devnet, no network - so CI covers the settlement *sequence* the agents speak
 * (and the `reference` threading + escrow lifecycle), not just the individual parsers in isolation.
 *
 * Here the sellers bid from sample data so the focus is the end-to-end protocol composition (the wire
 * format + selection + the `reference` threading), not the bidding economics.
 */
import { describe, it, expect } from 'vitest'
import {
  formatWant, parseWant, formatBid, parseBid, formatAward, parseAward,
  formatEscrowRequired, parseEscrowRequired, formatDeposited, parseDeposited,
  selectBids, pickCheapest, verb,
  type Bid,
} from './protocol.js'

/** A tiny in-memory escrow ledger mirroring the on-chain program's externally-visible behaviour. */
class FakeEscrow {
  private accts = new Map<string, { seller: string; amount: number; released: boolean }>()
  private bal = new Map<string, number>()
  private k = (buyer: string, ref: string) => `${buyer}:${ref}`
  deposit(buyer: string, seller: string, ref: string, amount: number): void {
    if (this.accts.has(this.k(buyer, ref))) throw new Error('reuse') // `init`, not `init_if_needed`
    this.accts.set(this.k(buyer, ref), { seller, amount, released: false })
  }
  isFunded(buyer: string, seller: string, ref: string, min: number): boolean {
    const a = this.accts.get(this.k(buyer, ref))
    return !!a && a.seller === seller && a.amount >= min && !a.released
  }
  release(buyer: string, seller: string, ref: string): void {
    const a = this.accts.get(this.k(buyer, ref))
    if (!a || a.seller !== seller) throw new Error('wrong escrow')
    a.released = true
    this.bal.set(seller, (this.bal.get(seller) ?? 0) + a.amount)
  }
  balance = (addr: string): number => this.bal.get(addr) ?? 0
}

const BUYER = 'BUYERxWa11et'
const SELLERS = {
  'seller-cheap': { wallet: 'CHEAPxWa11et', bid: 0.0002 },
  'seller-premium': { wallet: 'PREMxWa11et', bid: 0.0005 },
}

describe('market round e2e - the full settlement sequence over the real protocol', () => {
  it('runs WANT -> BIDx2 -> AWARD -> ESCROW_REQUIRED -> DEPOSITED -> DELIVERED -> RELEASED', () => {
    const thread: string[] = []
    const escrow = new FakeEscrow()
    const round = 1
    const budget = 0.001

    // buyer broadcasts the need
    thread.push(formatWant({ round, service: 'coingecko', arg: 'SOL-USDC', budgetSol: budget }))
    const want = parseWant(thread.at(-1)!)!
    expect(want.service).toBe('coingecko')

    // each seller parses the WANT and bids (from the sample data, clamped to budget)
    for (const [name, s] of Object.entries(SELLERS)) {
      thread.push(formatBid({ round, priceSol: Math.min(s.bid, want.budgetSol), by: name, note: 'available' }))
    }

    // buyer collects the bids, picks the cheapest, and awards
    const bids: Bid[] = thread.map((t) => parseBid(t)).filter((b): b is Bid => !!b && b.round === round)
    expect(bids).toHaveLength(2)
    const winner = pickCheapest(selectBids(bids, round))!
    expect(winner.by).toBe('seller-cheap') // cheapest wins
    thread.push(formatAward(round, winner.by, 'cheapest for a price lookup'))

    // winning seller mints a single-use reference and demands escrow
    const award = parseAward(thread.at(-1)!)!
    expect(award.to).toBe('seller-cheap')
    const reference = 'REFsingleUse111'
    const sellerWallet = SELLERS[winner.by as keyof typeof SELLERS].wallet
    thread.push(formatEscrowRequired({ round, reference, seller: sellerWallet, amountSol: winner.priceSol, deadlineSecs: 600 }))

    // buyer parses the terms and deposits
    const terms = parseEscrowRequired(thread.at(-1)!)!
    expect(terms.reference).toBe(reference)
    expect(terms.amountSol).toBeLessThanOrEqual(budget) // budget respected
    escrow.deposit(BUYER, terms.seller, terms.reference, terms.amountSol)
    thread.push(formatDeposited({ round, reference: terms.reference, buyer: BUYER, sig: 'SIGdeposit' }))

    // seller verifies the escrow is funded for it, then delivers
    const dep = parseDeposited(thread.at(-1)!)!
    expect(dep.reference).toBe(reference) // the reference threads all the way through
    expect(escrow.isFunded(dep.buyer, sellerWallet, dep.reference, terms.amountSol)).toBe(true)
    thread.push(`DELIVERED round=${round} {"coin":"solana","usd":150}`)

    // buyer sees delivery and releases the escrow to the seller
    expect(verb(thread.at(-1)!)).toBe('DELIVERED')
    escrow.release(BUYER, sellerWallet, reference)
    thread.push(`RELEASED round=${round} sig=SIGrelease`)

    // -- invariants over the whole round --
    expect(thread.map((t) => verb(t))).toEqual([
      'WANT', 'BID', 'BID', 'AWARD', 'ESCROW_REQUIRED', 'DEPOSITED', 'DELIVERED', 'RELEASED',
    ])
    expect(escrow.balance(sellerWallet)).toBeCloseTo(winner.priceSol, 9) // seller paid exactly its bid
    expect(escrow.balance(SELLERS['seller-premium'].wallet)).toBe(0)     // the loser is never paid
  })

  it('the seller refuses delivery when the escrow names a different seller (isFunded gate)', () => {
    const escrow = new FakeEscrow()
    escrow.deposit(BUYER, 'CHEAPxWa11et', 'REF2', 0.0002)
    expect(escrow.isFunded(BUYER, 'IMPOSTORxWa11et', 'REF2', 0.0002)).toBe(false)
    expect(escrow.isFunded(BUYER, 'CHEAPxWa11et', 'REF2', 0.0002)).toBe(true)
  })

  it('a deposit cannot be re-used for the same (buyer, reference) - init, not init_if_needed', () => {
    const escrow = new FakeEscrow()
    escrow.deposit(BUYER, 'CHEAPxWa11et', 'REF3', 0.0002)
    expect(() => escrow.deposit(BUYER, 'CHEAPxWa11et', 'REF3', 0.0002)).toThrow(/reuse/)
  })

  it('selection ignores bids from other rounds', () => {
    const bids: Bid[] = [
      { round: 1, priceSol: 0.0002, by: 'a' },
      { round: 2, priceSol: 0.0001, by: 'b' }, // cheaper but wrong round
    ]
    expect(pickCheapest(selectBids(bids, 1))!.by).toBe('a')
  })
})
