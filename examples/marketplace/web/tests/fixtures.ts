import type { Round } from '../src/types'

/** A settled round — premium wins on value over cheap; lazy declined. Shapes match a real devnet run. */
export const settledRound: Round = {
  round: 1,
  want: { service: 'coingecko', arg: 'SOL-USDC', budgetSol: 0.001 },
  bids: [
    { by: 'seller-premium', priceSol: 0.0005, note: 'verified' },
    { by: 'seller-cheap', priceSol: 0.0002, note: 'undercut' },
  ],
  declined: ['seller-lazy'],
  award: { to: 'seller-premium', reason: 'verified data worth the premium for this lookup' },
  escrow: { reference: 'DKQy', seller: '7jwB', amountSol: 0.0005, deadlineSecs: 600 },
  deposit: { sig: '5syzoWto3RjRYfLMCAkJ', buyer: '47Dp' },
  delivered: { raw: '{"coin":"solana","usd":72.33}', data: { coin: 'solana', usd: 72.33 } },
  release: { sig: '3PMa9LBZn7VEMD1qZnmr' },
  status: 'settled',
}

/** A round still collecting bids. */
export const biddingRound: Round = {
  round: 2,
  want: { service: 'coingecko', arg: 'SOL-USDC', budgetSol: 0.001 },
  bids: [{ by: 'seller-cheap', priceSol: 0.0002 }],
  declined: [],
  status: 'bidding',
}

export const fixtureRounds: Round[] = [settledRound, biddingRound]
