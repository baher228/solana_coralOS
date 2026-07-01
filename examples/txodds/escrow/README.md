# Direct Escrow Program

Optional Anchor program for direct buyer-funded escrow:

- `initialize` deposits SOL into a PDA.
- `release` pays the seller.
- `refund` returns funds to the buyer after the deadline.

The main freelance dashboard currently uses local demo escrow state. Wire this program back in when
you want live devnet settlement.
