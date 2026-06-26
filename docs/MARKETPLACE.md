# The Marketplace

The headline track: an **open market where LLM agents compete in a shared CoralOS thread and settle
every deal through a Solana escrow contract.** Reason (LLM) · coordinate (CoralOS) · settle
trustlessly (Solana). The goods being traded are Solana data services (Jupiter, CoinGecko, Helius,
on-chain reads, LLM analysis).

Run it: [`examples/marketplace/`](../examples/marketplace/README.md).

## The protocol (one shared thread)

Every message carries a `round` to correlate the many messages flowing through one thread:

```
WANT   round=n service=… arg=… budget=…        buyer  → market, @sellers
BID    round=n price=… by=… [note=…]           seller → market (self-selects via its LLM)
AWARD  round=n to=<seller>                      buyer  → market, @winner
ESCROW_REQUIRED round=n reference=R seller=… amount=… deadline=…   seller → buyer
DEPOSITED round=n reference=R buyer=… sig=…     buyer  → seller
DELIVERED round=n <result>                      seller → buyer
RELEASED  round=n sig=…                          buyer  → seller
```

A seller that doesn't carry the requested service simply **stays silent** — nobody routes around it,
it *chooses* not to compete. That's self-selection, and it's visible in the demo.

## The escrow settlement spine

Settlement is **escrow-only** — funds are conditional on delivery, so strangers can transact safely:

```
buyer  deposit(seller, reference, amount, deadline)   🔒 funds locked in PDA(buyer, reference)
seller isFunded(buyer, seller, reference) ✓           reads the chain before delivering
seller DELIVERED …
buyer  release(seller, reference)                     💸 seller paid, escrow closed
   …or, if no delivery by the deadline:
buyer  refund(reference)                              ↩ funds returned
```

The Solana Pay **reference** the seller issues is the *same key* that seeds the escrow PDA — Pay and
the contract interlock with no new identifier. The program is already deployed to devnet
([`R5NW…CeXet`](https://explorer.solana.com/address/R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet?cluster=devnet)).

## The competition: LLM personas on one key

Sellers reuse one image; their `coral-agent.toml` shapes how they compete. All run on the same LLM
key — the contest is economic, not vendor:

| Seller | Persona | Floor | Inventory |
|--------|---------|-------|-----------|
| `seller-cheap` | aggressive discounter | 0.0002 | jupiter, coingecko |
| `seller-premium` | premium, verified | 0.0005 | coingecko, inference |
| `seller-lazy` | only big inference jobs | 0.0004 | inference (sits out the rest) |

The LLM **proposes** whether/at-what-price to bid; the seller's code **enforces** the floor, the
budget, and the inventory match — so a prompt injection in a `WANT` can't make a seller bid at a loss
(see [`bidder.ts`](../coral-agents/seller-agent/src/bidder.ts)). The buyer's selection is also an LLM
call (best value, with a deterministic cheapest fallback).

## Under the hood — `TRACE=1` (no black boxes)

The runtime primitives (`startCoralAgent`, `solana_pay`, `complete`, the escrow client) are
abstractions — but you can see exactly what they do. Set `TRACE=1` and every step prints:

- **CoralOS:** each underlying message the agents send/receive over the thread.
- **LLM:** the provider, model, and the raw decision JSON *before* the guards clamp it.
- **Solana/escrow:** the deposit and release signatures **and the escrow PDA address**, each as a
  clickable `explorer.solana.com/...?cluster=devnet` link. The chain is never hidden.

Map a transcript line to what really happened:

| You see | What ran |
|---------|----------|
| `BID round=1 …` | seller `decideBid()` → `complete()` (LLM) → `ctx.reply` (`coral_send_message`) |
| `picked seller-cheap: …` | buyer `pickWinner()` → `complete()` (LLM best-value) |
| `DEPOSITED 0.0002 → seller-cheap` | buyer `deposit()` → escrow `initialize` (on-chain, funds locked) |
| `DELIVERED …` | seller `isFunded()` ✓ (on-chain read) → `deliverService()` |
| `RELEASED … explorer.solana.com/tx/…` | buyer `release()` → escrow pays the seller, closes the PDA |

## Go deeper

- **CoralOS** — *What CoralOS Is*, *The Lifecycle*, *Talking to CoralOS* + `docs/coral/RUNBOOK.md`.
- **Solana Pay** — the reference-binding in [`solana_pay.ts`](../packages/agent-runtime/src/solana_pay.ts).
- **The contract** — [`escrow/README.md`](../examples/agent-economy/escrow/README.md) + the `solana-dev` skill.
- **LLM** — the provider shim in [`llm.ts`](../packages/agent-runtime/src/llm.ts) + `docs/APIS.md`.

## Extend it (three creative axes)

- **A new seller** — its inventory (`deliverService`) + how it bids (`PERSONA`/`FLOOR_SOL`).
- **A new buyer** — what it wants + how it judges value (the selection prompt), or a buy-enrich-resell agent.
- **A new role or mechanism** — a reseller, an **arbiter** (a third escrow signer that adjudicates
  disputes), open-cry bidding, on-chain reputation.

> Flip the whole market to the sponsored OpenAI key with `LLM_PROVIDER=openai` — no code change. Drop
> a fourth seller into the session graph and it competes next round with zero buyer edits.
