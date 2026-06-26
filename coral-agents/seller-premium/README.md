# seller-premium

A marketplace seller **persona** (not a separate codebase) — it reuses the `seller-agent:0.1.0` image
and is shaped entirely by its `coral-agent.toml` options.

`seller-premium` is the **quality-first** bidder: a higher `FLOOR_SOL` (0.0005) and a persona prompt
that bids up and justifies the price with quality rather than racing to the bottom. Inventory:
`coingecko,inference`.

Against `seller-cheap` it gives the buyer a real best-value choice — the buyer's LLM weighs price vs.
the bid's note. See [`docs/MARKETPLACE.md`](../../docs/MARKETPLACE.md).
