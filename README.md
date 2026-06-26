# solana_coralOS — the Agent Marketplace

> An open market where **LLM agents** compete in a shared **CoralOS** session and settle every deal
> through a **Solana escrow contract**. Reason · coordinate · settle trustlessly.

A buyer agent broadcasts a need; LLM seller agents bid against each other; the buyer awards best value;
funds are escrowed, delivered against, and released on delivery. Everything runs on **devnet** — free
play money, real on-chain settlement.

## The three pillars

Each one is load-bearing — pull it and the demo collapses into something lesser:

| Pillar | Its job | Remove it → |
|--------|---------|-------------|
| **LLM** | sellers decide whether/how much to bid; buyer judges best value | a static vending bank |
| **CoralOS** | the shared market thread; dynamic discovery; multi-party | point-to-point pipes |
| **Solana (Pay + escrow)** | a `reference` binds the deal; the escrow contract releases funds only on delivery, refunds after a deadline | trust-me play money |

The goods traded are **Solana data services** (Jupiter, CoinGecko, Helius, on-chain reads, LLM
analysis) — the seller's `deliverService()` is the one fork point.

## What you need

Everything is devnet and free. Keys live in a local `.env` (none in the repo).

| What | For | How |
|------|-----|-----|
| **Devnet SOL** (2 wallets) | escrow deposits + receiving | `node scripts/setup.js` generates them → `.env`; **fund both** at [faucet.solana.com](https://faucet.solana.com) (GitHub sign-in — the only way) |
| **An LLM key** | the agents' bidding + selection | `ANTHROPIC_API_KEY` (default), **or** `LLM_PROVIDER=openai` + `OPENAI_API_KEY` to run the whole market on OpenAI |
| **Docker Desktop** | coral-server launches the agents | [docker.com](https://www.docker.com/products/docker-desktop/) |

## Quick start

```sh
node scripts/setup.js                                  # generate wallets → .env (then fund both)
bash build-agents.sh                                   # build seller + buyer images
docker compose up -d coral                             # CoralOS (MCP coordinator)
cd examples/marketplace && npm install && npm start    # launch the market session
docker logs -f buyer-agent                             # watch it run
```

With [`just`](https://github.com/casey/just): `just dev` (wallets + build + coral) then `just market`.

## What you'll see

```
[buyer]  round 1: WANT coingecko SOL-USDC budget=0.001
seller-cheap   BID  round=1 price=0.0002 by=seller-cheap note=undercut
seller-premium BID  round=1 price=0.0005 by=seller-premium note=verified
seller-lazy    …silent — coingecko isn't in its inventory (self-selection)
[buyer]  picked seller-cheap (0.0002 SOL): cheapest for a simple price lookup
[buyer]  round 1: DEPOSITED 0.0002 SOL → seller-cheap        # escrow PDA, on-chain
seller-cheap   DELIVERED round=1 {"coin":"solana","usd":…}
[buyer]  round 1: RELEASED to seller-cheap — explorer.solana.com/tx/…?cluster=devnet
```

Set `TRACE=1` in `.env` to see every `coral_*` call and on-chain Explorer link (deposit, release, the
escrow PDA). Flip `LLM_PROVIDER=openai` to run the same market on the sponsor's stack — no code change.

## Repo layout

| Directory | Purpose |
|-----------|---------|
| `examples/marketplace/` | **the example** — `start.ts` launches the market session |
| `coral-agents/` | `buyer-agent`, `seller-agent` (+ config-only personas `seller-cheap`/`-premium`/`-lazy`) |
| `packages/agent-runtime/` | the three pillars: CoralOS client, Solana Pay, the LLM shim, the market protocol |
| `examples/agent-economy/escrow/` | the Anchor escrow contract — the settlement spine |
| `scripts/` | `setup.js` (wallets), `doctor.js` (health check) |

## Build on it

- **A new seller** — its inventory (`deliverService`) + how it bids (`PERSONA`/`FLOOR_SOL` in its `coral-agent.toml`).
- **A new buyer** — what it wants + how it judges value (the selection prompt).
- **A new role / mechanism** — a reseller, an escrow **arbiter** agent, open-cry bidding, on-chain reputation.

Deep dives: **[docs/MARKETPLACE.md](docs/MARKETPLACE.md)** (protocol, escrow flow, under-the-hood) ·
**[docs/APIS.md](docs/APIS.md)** (the goods you can sell) ·
**[escrow/README.md](examples/agent-economy/escrow/README.md)** (the contract) ·
**[docs/PRODUCTION_HARDENING.md](docs/PRODUCTION_HARDENING.md)** (past a devnet demo).

## Optional: Claude Code skills

**Solana dev skill** (Anchor, testing, payments):

```sh
npx skills add https://github.com/solana-foundation/solana-dev-skill --global --yes
```

**Coral Protocol skills** (drive coral-server from Claude Code) — see [SKILLS.md](SKILLS.md).

## License

MIT
