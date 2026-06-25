# Agent Economy on CoralOS

> A seller agent lists a service; buyers — **agent or human** — request it over CoralOS, pay in SOL
> on-chain, and the seller verifies the payment and delivers. **One protocol, one seller, two front
> doors.**

Every payment is a real on-chain **devnet** transaction. CoralOS (coral-server) is the coordination
fabric — a pure MCP message bus. Payments are settled agent-side in SOL, so coral-server runs
**stock and wallet-free** (no patched image, no keypair in the server).

```
                      ┌──────────────────────────┐
                      │   coral-server :5555      │  stock, wallet-free MCP bus
                      └──────────┬───────────────┘
                  launches agents │ per session (Docker socket)
        ┌──────────────────────────┼──────────────────────────┐
   ┌────▼─────┐              ┌─────▼──────┐             ┌──────▼──────┐
   │  seller  │◀──request───▶│   buyer    │             │ user-proxy  │
   │  agent   │   /paid      │ (autonomous│             │  (human's   │
   │          │              │  pays SOL) │             │  stand-in)  │
   └────▲─────┘              └────────────┘             └──────▲──────┘
        │ same request/paid protocol                          │ puppet API
        └──────────────────── bridge :3010 ───────────────────┘
                          (Phantom front door)
```

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) running (coral-server launches the agents)
- [Node.js 20+](https://nodejs.org)
- A funded devnet wallet + (optional) Anthropic key — see the [root README](../../README.md#-keys--accounts-you-need). Generate with `node ../../scripts/setup.js`.
- For the human door: [Phantom](https://phantom.com) set to **Devnet**.

## Build the agent images once

coral-server launches `seller-agent` / `buyer-agent` / `user-proxy` as containers, so build them first:

```sh
cd ../..                               # repo root
bash build-agents.sh seller
bash build-agents.sh buyer
docker build -t user-proxy:0.1.0 coral-agents/user_proxy
```

## Start coral-server

```sh
docker compose up -d coral             # stock coral-server, wallet-free config
```

---

## Front door 1 — autonomous (agent buys from agent)

```sh
cd examples/agent-economy/autonomous && npm install && npm start
```

Creates a session naming `[buyer-agent, seller-agent]` (passing each agent's required options from
`.env`). coral spawns both; the buyer opens a thread and runs the loop. Watch it settle:

```sh
docker logs -f buyer-agent     # "paying reference=…" → "received data"
docker logs -f seller-agent    # "payment verified — delivering service"
```

Each cycle is a real devnet tx — paste the sig into [explorer](https://explorer.solana.com/?cluster=devnet).

## Front door 2 — human checkout (Phantom)

```sh
docker compose up -d bridge            # the human → user-proxy bridge on :3010
# open http://localhost:3010  (Phantom on Devnet)
```

Pick a service, click **Request & Pay**. The bridge injects your order into a CoralOS session *as*
`user-proxy`, the seller replies with a Solana Pay URL, Phantom signs the transfer, the seller
verifies on-chain and delivers — the same seller the autonomous buyer uses.

> Headless check (no browser): `cd bridge && npm install && npm run smoke` — pays from the funded
> keypair in place of the Phantom click and asserts delivery.

## No Docker? — the quickstart

[`quickstart/`](quickstart/) is the same pay-per-call loop as two bare-metal Node processes over
plain HTTP `402` — no Docker, no CoralOS. The fastest way to understand the payment cycle.

---

## The fork points

```
coral-agents/seller-agent/src/service.ts → deliverService(request)
    what gets sold. SERVICE env: jupiter | coingecko | news | inference (a Claude completion)

coral-agents/buyer-agent/src/{goal.ts, llm_buyer.ts}
    what the autonomous buyer wants + how it decides to pay (code-enforced budget)

config/coral.toml  → register a new agent (drop it in coral-agents/, add to localAgents)
bridge/server.ts   → a new human/front-door flow
```

## How it's wired

| Piece | Role |
|---|---|
| `config/coral.toml` | wallet-free MCP config; registers the agents from `coral-agents/` |
| `autonomous/start.ts` | creates the `[buyer, seller]` session (with typed agent options) |
| `bridge/server.ts` | human → `user-proxy` puppet bridge; reads replies from session state; self-serves the Phantom UI |
| `bridge/web/index.html` | framework-free Phantom checkout |
| `quickstart/` | no-Docker bare-metal 402 version |
| `../../docker-compose.yml` | coral-server + bridge (run from repo root) |

Devnet only. Never put a funded mainnet keypair in `.env`.
