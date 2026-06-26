import type { Round } from '../types'
import { RoundCard } from './RoundCard'

/** The live market feed — newest round first. */
export function MarketView({ rounds }: { rounds: Round[] }) {
  if (rounds.length === 0) {
    return <p className="empty" data-testid="empty">Waiting for the buyer to broadcast a WANT…</p>
  }
  const newestFirst = [...rounds].sort((a, b) => b.round - a.round)
  return (
    <div className="market" data-testid="market">
      {newestFirst.map((r) => (
        <RoundCard key={r.round} round={r} />
      ))}
    </div>
  )
}
