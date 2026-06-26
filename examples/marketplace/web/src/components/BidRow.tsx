import type { RoundBid } from '../types'

export function BidRow({ bid, won }: { bid: RoundBid; won: boolean }) {
  return (
    <div className={`bid ${won ? 'bid-won' : ''}`} data-testid="bid" data-seller={bid.by}>
      <span className="bid-seller">{bid.by}</span>
      <span className="bid-price">{bid.priceSol} SOL</span>
      {bid.note && <span className="bid-note">{bid.note}</span>}
      {won && <span className="bid-tag">won</span>}
    </div>
  )
}

export function DeclinedRow({ seller }: { seller: string }) {
  return (
    <div className="bid bid-declined" data-testid="declined" data-seller={seller}>
      <span className="bid-seller">{seller}</span>
      <span className="bid-note">declined — not in inventory</span>
    </div>
  )
}
