# seller-lazy

A marketplace seller **persona** (not a separate codebase) — it reuses the `seller-agent:0.1.0`
image and is shaped entirely by its `coral-agent.toml` options.

`seller-lazy` carries only `inference` in its `SERVICES` inventory, so it **stays silent** on any
`WANT` for a service it doesn't sell. That makes seller self-selection visible in the demo: when the
buyer asks for `coingecko`, `seller-cheap` and `seller-premium` bid while `seller-lazy` sits the round
out — no router excluded it; it *chose* not to compete.

See [`docs/MARKETPLACE.md`](../../docs/MARKETPLACE.md) for the full protocol and the persona table.
