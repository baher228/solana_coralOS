import { explorerTx } from '../types'

/** A settlement step with a clickable devnet Explorer link for its signature. */
export function SettlementBadge({ label, sig }: { label: string; sig: string }) {
  return (
    <a
      className="settle"
      data-testid="settle"
      href={explorerTx(sig)}
      target="_blank"
      rel="noreferrer"
    >
      {label} ↗
    </a>
  )
}
