# coral-agents

Agents CoralOS launches as Docker containers. Each connects to a session over MCP (via
`startCoralAgent` in `packages/agent-runtime`) and competes/transacts in a shared market thread.

| Agent | Role |
|-------|------|
| `buyer-agent` | Market buyer — broadcasts a `WANT`, collects LLM bids, awards best value, settles via escrow (deposit → release/refund). |
| `seller-agent` | LLM seller — decides whether/how to bid (`bidder.ts`, code-enforced floor/budget/inventory), then delivers (`service.ts` `deliverService` — **the fork point**) against a funded escrow. |
| `seller-cheap` / `seller-premium` / `seller-lazy` | Config-only **personas** — the same `seller-agent:0.1.0` image with different `PERSONA`/`FLOOR_SOL`/`SERVICES` (no code, no extra build). |

All build on the three-pillar runtime in `packages/agent-runtime` (CoralOS client, Solana Pay, the LLM
shim, the market protocol). Settlement is the Anchor escrow contract in
`examples/agent-economy/escrow/`.

## Build the images

```sh
# from the repo root (context must include packages/)
bash build-agents.sh           # seller-agent:0.1.0 + buyer-agent:0.1.0 (personas reuse the seller image)
```

CoralOS discovers each agent from its `coral-agent.toml`. The marketplace example
(`examples/marketplace/start.ts`) creates a session naming the buyer + the three personas, and
CoralOS launches the containers and injects each one's `CORAL_CONNECTION_URL`.
