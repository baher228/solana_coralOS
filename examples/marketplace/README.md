# Marketplace — the headline example

An open market where **LLM** seller agents compete in a shared **CoralOS** thread and the winner is
settled through the **Solana escrow contract**. One buyer broadcasts a need; three persona sellers
bid; the buyer awards best value; funds are escrowed, delivered against, and released on delivery.

```
WANT → (sellers bid) → AWARD best value → deposit (escrow) → DELIVERED → release
```

## Run it

Prereqs: Docker, a funded devnet wallet pair (`node scripts/setup.js`), and an `ANTHROPIC_API_KEY`
in `.env` (or `LLM_PROVIDER=openai` + `OPENAI_API_KEY` to run the whole market on OpenAI). The escrow
program is already deployed to devnet — no `anchor deploy` needed to run the demo.

```sh
bash build-agents.sh seller buyer          # build the two agent images (sellers reuse the seller image)
docker compose up -d coral                 # CoralOS (MCP coordinator)
cd examples/marketplace && npm install && npm start
```

Then watch the market:

```sh
docker logs -f buyer-agent     # WANT → AWARD (with a reason) → DEPOSITED → RELEASED
docker logs -f seller-cheap    # BID → ESCROW_REQUIRED → DELIVERED
```

## What you'll see

```
[buyer]  round 1: WANT coingecko SOL-USDC budget=0.001
seller-cheap   BID  round=1 price=0.0002 by=seller-cheap note=undercut
seller-premium BID  round=1 price=0.0005 by=seller-premium note=verified
seller-lazy    …silent — coingecko isn't in its inventory (self-selection)
[buyer]  picked seller-cheap (0.0002 SOL): cheapest for a simple price lookup
[buyer]  round 1: DEPOSITED 0.0002 SOL → seller-cheap
seller-cheap   DELIVERED round=1 {"coin":"solana","usd":…}
[buyer]  round 1: RELEASED to seller-cheap — https://explorer.solana.com/tx/…?cluster=devnet
```

## Knobs (`.env` or the session options)

| Var | Effect |
|-----|--------|
| `BUYER_SERVICE` | what the buyer shops for (`coingecko` → cheap+premium bid, lazy sits out) |
| `LLM_PROVIDER=openai` | flip the whole market to the sponsored OpenAI key — no code change |
| `TRACE=1` | log the `coral_*` calls + Explorer links for the escrow PDA, deposit, and release |
| `BUYER_MAX_SOL` | the budget cap each round |

## Visualize it (optional React dashboard)

Watch the auction in a browser instead of the logs — a read-only visualizer (no wallet) that renders
each round's bids, the winner + reasoning, and the escrow settlement with Explorer links:

```sh
just feed            # the feed server on :4000 (in another shell)
just dashboard       # the UI on :5173 → open ?session=<the market session id>
```

It's e2e-tested with fixtures (no devnet needed) — see [`web/`](web/README.md).

## Demo flourishes

- **Drop in a competitor live:** add a fourth seller to `start.ts`'s graph — it bids next round with
  zero buyer edits.
- **Flip the brain:** set `LLM_PROVIDER=openai` and re-run — same market, the sponsor's stack.

See [`docs/MARKETPLACE.md`](../../docs/MARKETPLACE.md) for the full protocol, the escrow flow, and the
"under the hood" walkthrough.
