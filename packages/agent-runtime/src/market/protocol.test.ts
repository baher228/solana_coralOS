import { describe, expect, it } from 'vitest'
import {
  formatAward, formatBid, formatDelivered, formatDeposited, formatEscrowRequired,
  formatRefunded, formatReleased, formatWant,
  messageRound, parseAward, parseBid, parseDeposited, parseEscrowRequired, parseWant,
  parseDelivered, parseRefunded, parseReleased,
  pickCheapest, selectBids, verb, type Bid,
} from './protocol.js'

describe('market protocol', () => {
  it('round-trips multi-word freelance WANT args', () => {
    const want = { round: 1, service: 'freelance', arg: 'Build checkout with mobile proof', budgetSol: 0.001 }
    expect(parseWant(formatWant(want))).toEqual(want)
  })

  it('round-trips bid, award, escrow, and deposit messages', () => {
    const bid = { round: 1, priceSol: 0.001, by: 'worker', wallet: 'WorkerWallet', note: 'available' }
    const award = { round: 1, to: 'worker', reason: 'best value' }
    const escrow = { round: 1, reference: 'R3f', seller: 'WorkerWallet', amountSol: 0.001, deadlineSecs: 600 }
    const deposited = { round: 1, reference: 'R3f', buyer: 'EmployerWallet', sig: 'Sig123' }

    expect(parseBid(formatBid(bid))).toEqual(bid)
    expect(parseAward(formatAward(award.round, award.to, award.reason))).toEqual(award)
    expect(parseEscrowRequired(formatEscrowRequired(escrow))).toEqual(escrow)
    expect(parseDeposited(formatDeposited(deposited))).toEqual(deposited)
  })

  it('selects current-round bids and the cheapest price', () => {
    const bids: Bid[] = [
      { round: 1, priceSol: 0.003, by: 'premium', wallet: 'PremiumWallet' },
      { round: 2, priceSol: 0.001, by: 'other', wallet: 'OtherWallet' },
      { round: 1, priceSol: 0.002, by: 'fast', wallet: 'FastWallet' },
    ]
    expect(selectBids(bids, 1)).toHaveLength(2)
    expect(pickCheapest(selectBids(bids, 1))?.by).toBe('fast')
    expect(verb('WANT round=1')).toBe('WANT')
    expect(messageRound('BID round=7 price=0.1 by=x')).toBe(7)
  })

  it('round-trips delivery and settlement messages', () => {
    const delivered = { round: 1, url: 'https://example.test', repo: 'https://github.com/acme/job', notes: 'done' }
    const settled = { round: 1, reference: 'R3f', sig: 'Sig123' }

    expect(parseDelivered(formatDelivered(delivered))).toEqual(delivered)
    expect(parseReleased(formatReleased(settled))).toEqual(settled)
    expect(parseRefunded(formatRefunded(settled))).toEqual(settled)
  })
})
