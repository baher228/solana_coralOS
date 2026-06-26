# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

A TypeScript-first starter kit for a Solana **agent economy**: a seller agent sells a service for SOL;
buyers — another agent (autonomous) or a human (Phantom checkout) — request it over **CoralOS** (MCP),
pay on-chain, and the seller verifies the payment and delivers. One track, two front doors. The core
stack is Node.js/TypeScript throughout (plus one ~40-line Python puppet) — no Rust. There is **one
optional Rust add-on**: an Anchor escrow under `examples/agent-economy/escrow/` (the trustless-settlement
upgrade), clearly marked as opt-in and not needed by the core track.

## Repo Layout

| Directory | Purpose |
|-----------|---------|
| `examples/marketplace/` | **The track.** `start.ts` launches the market session (buyer + 3 LLM seller personas). |
| `examples/agent-economy/` | `config/coral.toml` (wallet-free MCP config) + `escrow/` (the Anchor escrow contract — the settlement spine). |
| `coral-agents/` | Agents coral-server launches: `seller-agent` (LLM bidder + `service.ts` fork point), `buyer-agent` (market loop), and the config-only personas `seller-cheap`/`-premium`/`-lazy`. |
| `packages/agent-runtime/` | The three pillars: CoralOS MCP client (`startCoralAgent`), Solana Pay (`solana_pay.ts` + devnet guard), LLM (`llm.ts` provider shim), and the market protocol (`market.ts`). |
| `scripts/` | `setup.js` (wallet generation), `doctor.js` (health check). |
| `docs/`, `.claude/` | Design docs — `MARKETPLACE.md`, `APIS.md`, `PRODUCTION_HARDENING.md`, `SECURITY_REVIEW.md`. |

The headline (and only) example is `examples/marketplace/` on stock coral-server. CoralOS is the MCP
coordination layer only — settlement is the Solana escrow contract, agent-side (no coral-server wallet).

## Commands

### Run the marketplace (requires Docker)

```sh
node scripts/setup.js                                  # generate + fund devnet wallets → .env
bash build-agents.sh                                   # build seller + buyer images (personas reuse seller)
docker compose up -d coral                             # coral-server (MCP coordinator)
cd examples/marketplace && npm install && npm start    # launch the market session
docker logs -f buyer-agent                             # WANT → AWARD → DEPOSITED → RELEASED
# set LLM_PROVIDER=openai (+ OPENAI_API_KEY) in .env to flip the whole market to OpenAI
```

### packages/agent-runtime (agent runtime)

```sh
cd packages/agent-runtime && npm install
cd packages/agent-runtime && npm run typecheck
cd packages/agent-runtime && npm test
cd packages/agent-runtime && npm run build   # dependents (coral-agents, examples) need its dist
```

### Typecheck / test the economy

```sh
cd coral-agents/seller-agent && npm install && npm run typecheck && npm test   # incl. bidder + replay + payment
cd coral-agents/buyer-agent && npm install && npm run typecheck && npm test    # market loop + parse402
cd examples/marketplace && npm install && npm run typecheck                     # the session launcher
```

## Architecture

### packages/agent-runtime — the three pillars

Every agent imports these and writes only behavior:

- **CoralOS** — `coral_mcp.ts` (`CoralMcpAgent`: StreamableHTTP transport, tool discovery,
  `parseMention`) + `coral_mcp_server.ts` (`startCoralAgent` — joins a session, hands `run` a `ctx`).
- **Solana** — `solana.ts` (`solanaConnection`/`assertDevnet` guard) + `solana_pay.ts`
  (`generatePaymentUrl`/`verifyPayment`/`signTransfer`/`loadKeypairB58`, reference-bound).
- **LLM** — `llm.ts` (`complete()` — SDK-free shim; Anthropic default, `LLM_PROVIDER=openai` flips it).
- **Market protocol** — `market.ts` (pure WANT/BID/AWARD/ESCROW_REQUIRED/DEPOSITED format+parse +
  `selectBids`/`pickCheapest`). Coordination only — settlement is the escrow contract, agent-side.

### coral-agents (what coral-server launches)

- `seller-agent` — LLM bidder: `WANT → BID` (`bidder.ts`, code-enforced floor/budget/inventory) →
  `AWARD → ESCROW_REQUIRED → DEPOSITED →` verify escrow funded (`escrow.ts isFunded`) →
  `deliverService()` (`service.ts`, the fork point) `→ DELIVERED`. Legacy 1:1 `request/paid` kept.
- `buyer-agent` — market loop: broadcast `WANT`, collect bids, LLM best-value selection (cheapest
  fallback), `deposit` into escrow, `release` on delivery / `refund` after the deadline (`escrow.ts`).
- `seller-cheap` / `seller-premium` / `seller-lazy` — config-only personas over the seller image
  (different `PERSONA`/`FLOOR_SOL`/`SERVICES`); `seller-lazy` self-selects out of non-inventory jobs.

### examples/agent-economy/escrow — the settlement spine

The Anchor escrow program (deployed to devnet) + its TS client. The buyer deposits into a per-order
PDA seeded by `(buyer, reference)`, the seller delivers, the buyer releases (or refunds after a
deadline). The `reference` is the same Solana Pay key the order is bound to. See its `README.md`.

## Key Constraints

- **The CoralOS run loop should respect its `AbortSignal`** — `CoralMcpAgent.runLoop(handler, signal)` checks `signal.aborted`; `startCoralAgent` wires SIGINT/SIGTERM to a clean disconnect.
- **coral-server launches agents via the Docker socket** — build the agent images before `docker compose up`.
- **Devnet only** — agent payment code builds its `Connection` via `solanaConnection()` (`@pay/agent-runtime`), which throws on a mainnet RPC unless `ALLOW_MAINNET=1`; it defaults to `https://api.devnet.solana.com`. Never put a funded mainnet keypair in `.env`.
- **The `coral-agents` / `examples` packages depend on `@pay/agent-runtime` via `file:` deps** — run `npm run build` in `packages/agent-runtime` first so the dist exists.
