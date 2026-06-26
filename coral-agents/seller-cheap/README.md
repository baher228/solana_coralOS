# seller-cheap

A marketplace seller **persona** (not a separate codebase) — it reuses the `seller-agent:0.1.0` image
and is shaped entirely by its `coral-agent.toml` options.

`seller-cheap` is the **aggressive discounter**: a low `FLOOR_SOL` (0.0002) and a persona prompt that
bids low to win volume — but its code never lets the LLM bid below the floor. Inventory:
`jupiter,coingecko`.

Differentiation across personas is `PERSONA` + `FLOOR_SOL` + `SERVICES` — all on the same LLM key, so
the competition is economic, not vendor. See [`docs/MARKETPLACE.md`](../../docs/MARKETPLACE.md).
