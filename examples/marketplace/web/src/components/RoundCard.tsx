import type { Round } from '../types'
import { StatusPill } from './StatusPill'
import { BidRow, DeclinedRow } from './BidRow'
import { SettlementBadge } from './SettlementBadge'

/** One auction round: the need, the competing bids, the award + reasoning, and on-chain settlement. */
export function RoundCard({ round }: { round: Round }) {
  const winner = round.award?.to
  return (
    <article className="round" data-testid="round" data-round={round.round}>
      <header className="round-head">
        <span className="round-n">#{round.round}</span>
        {round.want && (
          <span className="round-want">
            <strong>{round.want.service}</strong> {round.want.arg}
            <span className="round-budget">budget {round.want.budgetSol} SOL</span>
          </span>
        )}
        <StatusPill status={round.status} />
      </header>

      <div className="bids">
        {round.bids.map((b) => (
          <BidRow key={b.by} bid={b} won={b.by === winner} />
        ))}
        {round.declined.map((s) => (
          <DeclinedRow key={s} seller={s} />
        ))}
      </div>

      {round.award?.reason && (
        <p className="reason" data-testid="reason">
          <em>“{round.award.reason}”</em>
        </p>
      )}

      {round.delivered && (
        <pre className="delivered" data-testid="delivered">{round.delivered.raw}</pre>
      )}

      <footer className="settle-row">
        {round.deposit && <SettlementBadge label={`deposit ${round.escrow?.amountSol ?? ''} SOL`} sig={round.deposit.sig} />}
        {round.release && <SettlementBadge label="release" sig={round.release.sig} />}
        {round.refunded && <span className="settle settle-refund" data-testid="refund">refunded</span>}
      </footer>
    </article>
  )
}
