# Restructure → One Track: "Agent Economy on CoralOS"

**Date:** 2026-06-25
**Goal:** Collapse the two tracks into a single, coherent `examples/agent-economy/` where a **seller
agent sells a service for SOL, coordinated over CoralOS (MCP)**, and the **buyer is either another
agent (autonomous) or a human (Phantom, bridged via `user_proxy`)**. CoralOS is the coordination
fabric for both. Every payment is real on-chain devnet SOL.

---

## 0. The thesis (one sentence)

> A seller agent lists a service; buyers — agent *or* human — request it over CoralOS, pay in SOL
> on-chain, and the seller verifies the payment and delivers. One protocol, one seller, two front doors.

---

## 1. The architectural unlock (why this is cheap)

**coral-server runs as a pure MCP coordinator with NO wallet config.** The existing
`docs/coral/track-1-config.toml` has only `[auth] [network] [registry] [docker]` — no `[wallet]`.
Payments happen **agent-side** via `@solana/web3.js` (seller `payment.ts`, buyer `wallet.ts`), *not*
through coral-server's native rail.

Consequences:
- The upstream `WalletDecoder` / x402 bug we fixed is **irrelevant here** — we never load a wallet
  into coral-server. **Use stock `ghcr.io/coral-protocol/coral-server:latest`. No patched image.**
- The only hard dependency is **Docker** (coral-server launches agents via the Docker socket).
- Everything that's already proven stays proven: the MCP handshake (smoke-mcp, GREEN) and on-chain
  SOL settlement (devnet tx). This restructure *composes* them; it doesn't re-invent them.

---

## 2. Architecture — one seller, two front doors

```
                        ┌─────────────────────────────────────────┐
                        │            coral-server :5555            │
                        │      (stock, wallet-free MCP bus)        │
                        └───────────────┬─────────────────────────┘
                       MCP (StreamableHTTP) │ launches agents as containers
            ┌───────────────────────────────┼───────────────────────────────┐
            │                               │                                │
   ┌────────▼─────────┐            ┌────────▼─────────┐            ┌─────────▼────────┐
   │   seller-agent   │            │   buyer-agent    │            │   user-proxy     │
   │  (fulfillment)   │◄──thread──►│  (autonomous)    │            │ (human's stand-in)│
   │ request→PAY_REQ  │            │ pays from keypair│            └─────────▲────────┘
   │ paid  →DELIVERED │            └──────────────────┘                     │ puppet API
   └────────▲─────────┘                                                     │ (Bearer dev)
            │                                                     ┌─────────┴────────┐
            │  same request/paid protocol                        │  checkout-bridge  │  :3010
            └────────────────────────────────────────────────────┤  injects as       │
                                                                  │  user-proxy       │
                                                                  └─────────▲────────┘
                                                                            │ HTTP
                                                                  ┌─────────┴────────┐
                                                                  │  Phantom web UI   │  :3000
                                                                  │  (human signs tx) │
                                                                  └──────────────────┘
```

The **seller-agent is identical** in both paths — it speaks one protocol:
`request <query>` → `PAYMENT_REQUIRED memo=… amount=… url=solana:…` ; `paid <sig> memo=…` →
`DELIVERED <data>`. It does not know or care whether the counterparty is an agent or a human.

---

## 3. The human → `user_proxy` bridge (concrete)

This is the only genuinely new code. It is `smoke-mcp.ts` (verified GREEN) generalized, pointed at
`seller-agent`, with a Phantom payment in the middle. All puppet routes/shapes are **already
confirmed against a live server**:

```
POST /api/v1/local/session                                → { namespace, sessionId }
POST /api/v1/puppet/{ns}/{sid}/user-proxy/thread          → { thread: { id } }
POST /api/v1/puppet/{ns}/{sid}/user-proxy/thread/message  → { status }
GET  /api/v1/puppet/{ns}/{sid}/user-proxy/thread/{tid}    → messages   (poll)
Auth: Authorization: Bearer dev
```

**Order sequence (bridge ↔ coral ↔ seller-agent ↔ Phantom):**

```
1. Browser → bridge        POST /order { service }
2. bridge  → coral         ensure session [seller-agent, user-proxy]; open thread
3. bridge  → coral         inject "request <service>"  (as user-proxy)
4. seller-agent → thread   "PAYMENT_REQUIRED memo=M amount=A url=solana:…"
5. bridge  → browser       { memo: M, solanaPayUrl }           (poll resolves)
6. Browser (Phantom)       signs + sends the SOL transfer on devnet → sig
7. Browser → bridge        POST /order/:memo/paid { sig }
8. bridge  → coral         inject "paid <sig> memo=M"   (as user-proxy)
9. seller-agent → thread   "DELIVERED <data>"
10. bridge → browser       { status: 'delivered', data }        (poll resolves)
```

The bridge holds a tiny `memo → { threadId, status }` map. The seller already tracks `pending` by
memo, so verification/delivery is unchanged.

---

## 4. Target file layout

```
examples/agent-economy/
  README.md                  ← the single-thesis guide (keys, both front doors)
  docker-compose.yml         ← coral-server + bridge + web  (+ session bootstrap)
  config/coral.toml          ← wallet-free MCP config (from track-1-config.toml, retitled)
  bridge/
    server.ts                ← human→user-proxy puppet bridge + Phantom order endpoints
    web/index.html           ← Phantom checkout UI (moved from track-2)
  autonomous/
    start.ts                 ← creates a session [buyer-agent, seller-agent] to kick off the loop
  quickstart/                ← OPTIONAL no-Docker path (moved from track-1 bare-metal 402)
    server.ts  buyer.ts  verify.ts  README.md

coral-agents/                ← UNCHANGED — the agent sources coral-server builds & registers
  seller-agent/  buyer-agent/  user_proxy/  echo-agent/
```

---

## 5. What moves / what's deleted

| From | To | Note |
|---|---|---|
| `examples/track-1-pay-per-call/{server,buyer,verify}.ts` | `examples/agent-economy/quickstart/` | becomes the **no-Docker quickstart mode** (same 402 logic, no CoralOS) |
| `examples/track-2-consumer-checkout/web/index.html` | `examples/agent-economy/bridge/web/` | the Phantom UI, repointed at the bridge |
| `examples/track-2-consumer-checkout/server.ts` | folded into `bridge/server.ts` | gains the puppet-bridge logic; loses the direct-transfer build (seller-agent builds the pay URL now) |
| `docs/coral/track-1-config.toml` | `examples/agent-economy/config/coral.toml` | drop the stale "Anchor Escrow" title |
| root `docker-compose.yml` | rewritten | currently stale (3 tracks, ghcr images, helius monitor) |
| `web/` nav + `/track-1`, `/track-2` pages | single `/economy` (toggle: Autonomous \| Checkout) | or keep two pages but one nav group |
| `examples/track-1-pay-per-call/`, `examples/track-2-consumer-checkout/` | **deleted** after move | |

---

## 6. docker-compose.yml (single track)

```yaml
services:
  coral:                         # stock — pure MCP bus, wallet-free
    image: ghcr.io/coral-protocol/coral-server:latest
    ports: ["5555:5555"]
    environment:
      - CONFIG_FILE_PATH=/config/coral.toml
      # passed through to the agents coral launches:
      - SELLER_WALLET=${WALLET}
      - BUYER_KEYPAIR_B58=${BUYER_KEYPAIR_B58}
      - PRICE_SOL=${PRICE_SOL:-0.0001}
      - SERVICE=${SERVICE:-jupiter}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - SOLANA_RPC_URL=${SOLANA_RPC_URL:-https://api.devnet.solana.com}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./examples/agent-economy/config/coral.toml:/config/coral.toml:ro
      - ./coral-agents:/agents:ro

  bridge:                        # human → user-proxy puppet bridge
    build: ./examples/agent-economy/bridge
    ports: ["3010:3010"]
    environment: [ CORAL_SERVER_URL=http://coral:5555, CORAL_TOKEN=dev ]
    depends_on: [coral]

  web:                           # Phantom UI + autonomous viewer
    build: ./web
    ports: ["3000:3000"]
    environment: [ NEXT_PUBLIC_BRIDGE_URL=http://localhost:3010, NEXT_PUBLIC_CORAL_SERVER=http://localhost:5555 ]
    depends_on: [bridge]
```

> **Note:** coral-server spawns `seller-agent`/`buyer-agent`/`user-proxy` *per session*, not as
> compose services. The **autonomous** loop starts when something creates a session naming
> `[buyer-agent, seller-agent]` (`autonomous/start.ts`, or a "Run autonomous demo" button in web).
> The **human** path creates its session `[seller-agent, user-proxy]` on the first order.

---

## 7. Verification gates (must pass, in order)

| Gate | Proves | How |
|---|---|---|
| **G1** | stock coral-server boots wallet-free; agents register | `docker compose up coral`; `localAgentRescanTimer` picks up `/agents/*`; smoke-mcp echo still GREEN |
| **G2** | autonomous loop settles over CoralOS | `autonomous/start.ts` → session [buyer,seller] → buyer pays seller on-chain → `DELIVERED` in thread → tx on explorer |
| **G3** | human path delivers over CoralOS | bridge order → Phantom pays → `DELIVERED` returned to browser |

G2 is the headline proof: it fuses the already-green MCP handshake (Gate A) and on-chain SOL
settlement (Gate B) into one continuous loop **coordinated by CoralOS**.

---

## 8. Execution steps (commit per step)

1. Scaffold `examples/agent-economy/` + `config/coral.toml` (wallet-free).
2. Rewrite root `docker-compose.yml` for the single track (stock coral-server).
3. **Verify G1 + G2** — the core agent-economy-on-CoralOS proof. *(Do not proceed until green.)*
4. Build `bridge/server.ts` from the smoke-mcp pattern; move the Phantom UI; wire Phantom payment. **Verify G3.**
5. Move track-1 bare-metal → `quickstart/`; write its mini-README.
6. Delete old `track-1`/`track-2` dirs; collapse web nav to one economy.
7. Rewrite root `README.md` to the single thesis (keys section preserved, two front doors).
8. Update `CLAUDE.md` repo layout + `.claude/AUDIT.md` follow-ups.

---

## 9. Risks & decisions

- **Docker is now required** (coral-server uses the Docker socket). Accepted; the `quickstart/`
  no-Docker mode is the mitigation for fast onboarding.
- **Bridge home:** standalone in the track (recommended — keeps `api-ts` light) vs. folded into
  `api-ts` (already has the runtime). Going standalone.
- **Session lifecycle (human):** reuse one long-lived `[seller-agent, user-proxy]` session, one
  thread per order. Simpler than create-per-order; the memo namespaces orders.
- **Web nav:** one `/economy` page with an *Autonomous | Checkout* toggle (recommended) — keeps the
  "one system, two front doors" story visually true.
- **Provider lock-in (still open):** buyer/seller LLM calls are Anthropic-only. Orthogonal to this
  restructure; tackle separately.
```
