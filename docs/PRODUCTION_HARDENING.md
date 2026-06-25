# Production Hardening Roadmap

This kit is a **devnet teaching scaffold** — optimized to get an agent economy running and forkable
in minutes, on a free test network, with no real money at risk. That's deliberate. This document
maps what stands between that and a **production** system handling real value, so a fork can pick a
direction with eyes open.

Nothing here is a bug in the kit as-shipped. These are the things a devnet starter intentionally
leaves out, ranked by what actually matters first.

> **Already done this session:** a **mainnet safety guard** in `packages/agent-runtime/src/agent.ts`
> (`setRpc` rejects a mainnet RPC unless `ALLOW_MAINNET=1`). See [§1.2](#12-mainnet-guard--done).

---

## How to read this

Each item: **what** it is, **why** it matters in production, **how** to approach it (with the real
files), rough **effort**, and **priority**. The [roadmap table](#prioritized-roadmap) at the end is
the TL;DR.

Priorities assume the goal is *"take this exact architecture to mainnet with real users."* If your
goal is narrower (e.g. internal agents only), re-rank accordingly.

---

## 1. Security

The highest-stakes category — these gate any real-money deployment.

### 1.1 Payment replay protection — **✅ done (in-memory)**

A `ReplayGuard` ([`coral-agents/seller-agent/src/replay.ts`](../coral-agents/seller-agent/src/replay.ts))
now records consumed signatures; the `paid` handler rejects a `sig` already used as proof. Unit-tested
(`replay.test.ts` + `payment.test.ts`, 9 cases). **Still in-memory** — a restart forgets consumed
sigs; back it with a durable store (Redis/SQLite) for production, and consider the reference-based
upgrade below. The quickstart already uses reference-based verification, which is replay-resistant by
construction.

<details><summary>Original finding</summary>

**What:** The seller verifies a payment by signature
([`coral-agents/seller-agent/src/payment.ts`](../coral-agents/seller-agent/src/payment.ts) →
`verifyPayment(sig, memo)`) — it confirms the tx paid the right amount to the right wallet. It does
**not** record that a signature was *already used*.

**Why it matters:** A buyer can request a service twice (two memos), pay **once**, and submit the
**same `sig`** as proof for both. Both verify (same recipient + amount on-chain), so the buyer gets
two deliveries for one payment. On devnet this is harmless; with real money it's free goods.

**How:**
- Add a consumed-signature set in the seller (persist it — Redis/SQLite — so it survives restarts).
- In the `paid` handler ([`seller-agent/src/index.ts`](../coral-agents/seller-agent/src/index.ts)),
  reject a `sig` already in the set; add it on success.
- Stronger: use Solana Pay's **`reference`** key (a unique pubkey per request) and
  `findReference`/`validateTransfer` from `@solana/pay`, so each payment is bound to one request at
  the protocol level rather than matched by amount.

**Effort:** S–M. **Priority:** 🔴 **highest** — do this before anything else touches real value.

</details>

### 1.2 Mainnet guard — **✅ done**

`setRpc` now throws on a `mainnet` RPC unless `ALLOW_MAINNET=1`, so an accidental endpoint can't move
real funds with a devnet-intended key. Extend it to also gate the agents' direct
`new Connection(...)` calls (seller `payment.ts`, buyer `wallet.ts`) if you want the guard everywhere.

### 1.3 Auth tokens

**What:** coral-server auth is the default `"dev"` token (`config/coral.toml` `[auth] keys=["dev"]`,
and `CORAL_TOKEN ?? 'dev'` in `start.ts` / `bridge/server.ts` / `smoke-mcp.ts`).

**Why:** Anyone who can reach the coral-server port can drive sessions and impersonate `user-proxy`.

**How:** Generate real tokens, load from secrets, scope per-client. Put coral-server behind auth at
the network layer too (it's currently `allowAnyHost = true`).

**Effort:** S. **Priority:** 🟠 high (required the moment coral-server isn't on localhost).

### 1.4 Key custody

**What:** The buyer's signing key is a base58 secret in `.env` (`BUYER_KEYPAIR_B58`) — a hot wallet
loaded into the process. (The seller only holds a **public** key — receive-only, fine.)

**Why:** A leaked buyer key drains the buyer wallet. In production an agent that spends real funds
needs better custody than a plaintext env var.

**How:** A KMS/HSM or a signer service the agent calls; per-agent spend limits (the buyer already has
a code-enforced budget — extend it); short-lived delegated keys.

**Effort:** M–L. **Priority:** 🟠 high for any spending agent on mainnet.

### 1.5 Input validation & rate limiting

**What:** The bridge and seller parse message text with regex
([`bridge/server.ts`](../examples/agent-economy/bridge/server.ts),
[`seller-agent/src/index.ts`](../coral-agents/seller-agent/src/index.ts)); endpoints are unthrottled.

**Why:** Malformed input, oversized payloads, and request floods are free today.

**How:** Schema-validate order/payment bodies (zod); add per-IP/per-agent rate limits and request
size caps; a global error handler so one bad request can't crash a server (the bare-metal seller
already had one unhandled-rejection crash, since fixed).

**Effort:** S–M. **Priority:** 🟡 medium.

---

## 2. Trust & settlement

The kit's payment flow is **pay-first**: the buyer pays, *then* the seller verifies and delivers.

### 2.1 The trust asymmetry → escrow

**What:** The buyer sends payment proof and the seller delivers afterward. If delivery fails (or the
seller is dishonest), the buyer has already paid. The seller wraps `deliverService` in try/catch and
returns `ERROR`, but the funds are gone.

**Why:** With real money, "pay a stranger's agent and hope it delivers" doesn't scale.

**How:** An **Anchor escrow program**: buyer deposits into an escrow PDA; funds release to the seller
only when delivery is confirmed (or refund on timeout). This is the trustless version of the loop.
`SKILLS.md` sketches this (`programs/escrow/`, an `AnchorEscrowStrategy`). The `HeliusMonitorStrategy`
in `agent-runtime` can watch the PDA for the deposit.

**Effort:** L (a Solana program + client + tests). **Priority:** 🟠 high for an open marketplace;
low for trusted/first-party agents.

### 2.2 Idempotency & exactly-once delivery

**What:** No retry/dedup semantics. If the seller delivers but the buyer never receives it (network,
crash), there's no safe re-request without re-paying.

**How:** Idempotency keys per order; the seller caches the delivery for a verified payment and
re-serves it on retry instead of re-charging.

**Effort:** M. **Priority:** 🟡 medium.

### 2.3 Disputes & refunds

No mechanism today. Escrow with a timeout/refund path (2.1) is the foundation; a dispute/arbiter
agent is a further step.

**Effort:** L. **Priority:** 🟢 later.

---

## 3. Payments & commerce

### 3.1 Token support (SOL → USDC/SPL)

**What:** Settlement is native **SOL** (`SystemProgram.transfer`). Pricing in SOL means the real
price drifts with SOL's market price.

**How:** Accept **USDC** (or any SPL token) via token transfers / Token-2022; price in a stablecoin.
`SKILLS.md`'s Solana-skill notes call this out (Token-2022, Commerce Kit).

**Effort:** M. **Priority:** 🟠 high for real commerce (price stability).

### 3.2 Dynamic pricing

`PRICE_SOL` is a fixed env value. Real services need per-request quotes, tiered pricing, and slippage
windows. **Effort:** M. **Priority:** 🟡 medium.

### 3.3 Mainnet migration

The whole devnet→mainnet path: funded wallets, the mainnet guard opt-in (1.2), real RPC providers
with rate limits, priority fees / compute budget, and a security review of every on-chain call.
**Effort:** M (mostly process + review). **Priority:** gating — do **after** §1.

---

## 4. Reliability & operations

### 4.1 CI — **✅ coverage gap closed**

`.github/workflows/ci.yml` now has an **`agent-economy`** job that typechecks all three
`coral-agents` and the three `examples/agent-economy/*` packages, and runs the seller-agent tests.
(Every package also gained a uniform `npm run typecheck`.) **Still future:** running the smoke
gates (`scripts/smoke/*`, `bridge/smoke.ts`) against an ephemeral coral-server in CI, and `npm audit`.

### 4.2 Test coverage — **✅ payment path tested**

`verifyPayment` is now unit-tested (`coral-agents/seller-agent/src/payment.test.ts`: full price,
1% tolerance, underpayment, wrong recipient, missing tx, RPC-error-fails-closed) and the
`ReplayGuard` (`replay.test.ts`). 20 tests across the runtime + seller now pass. **Thin spots
remaining:** the buyer budget guard and the bridge order flow; the Solana skill's **LiteSVM** would
let you test richer on-chain logic without a live devnet.

### 4.3 Observability

`log.ts` supports JSON logs; agents mostly `console.error`. Production wants structured logs end to
end, request IDs across the bridge↔coral↔seller hop, and metrics (payments/sec, verify failures).
**Effort:** M. **Priority:** 🟡 medium.

### 4.4 coral-server as a single point of failure

coral-server coordinates everything and launches agents via the Docker socket. In production: HA /
restart policy, resource limits, and a story for in-flight sessions when it restarts.
**Effort:** M–L. **Priority:** 🟡 medium.

### 4.5 Agent & session lifecycle

Sessions/agents are spawned per request; no explicit cleanup of stale sessions, crashed agents, or
leaked containers. Add health checks, session TTLs, and reaping. **Effort:** M. **Priority:** 🟡
medium.

---

## 5. Extensibility & product

### 5.1 LLM provider lock-in

**What:** The buyer ([`llm_buyer.ts`](../coral-agents/buyer-agent/src/llm_buyer.ts)) and the seller's
`inference` service use the Anthropic SDK directly.

**How:** A thin provider interface (`complete(prompt, opts)`) with Anthropic + OpenAI implementations,
selected by which key is present. Widens who can run the kit out of the box.

**Effort:** S–M. **Priority:** 🟡 medium (it's an onboarding nicety, not a security/correctness gap).

### 5.2 Agent discovery, identity & reputation

Today the buyer knows the seller by name in one session. A real economy needs discovery (who sells
what), verifiable **identity** (on-chain agent registry — `SKILLS.md` sketches a PDA), and
**reputation** to resist Sybil/cheap-seller attacks. **Effort:** L. **Priority:** 🟢 later (this is
"build a marketplace," i.e. a product on top of the kit).

---

## Prioritized roadmap

If you're taking this to mainnet, in order:

| # | Item | Why first | Effort |
|---|------|-----------|--------|
| 1 | **Replay protection** (1.1) | the one real security hole — free goods | ✅ **done** (in-memory) |
| 2 | **CI over all packages** (4.1) | catch regressions; we just renamed everything | ✅ **done** (typecheck; smoke-in-CI pending) |
| 3 | **Tests for the payment path** (4.2) | the security-critical code is under-tested | ✅ **done** (9 cases) |
| 4 | **Auth tokens + network auth** (1.3) | the moment coral-server leaves localhost | S |
| 5 | **USDC/SPL settlement** (3.1) | price stability for real commerce | M |
| 6 | **Escrow** (2.1) | trustless settlement for an open marketplace | L |
| 7 | **Key custody** (1.4) | safe spending on mainnet | M–L |
| 8 | Mainnet migration (3.3), observability (4.3), provider-flex (5.1) | round out | M each |

**The cheapest high-value trio — replay protection (1) + payment-path tests (3) + CI (2) — is now
✅ done.** The real security gap (signature replay) is closed and unit-tested, and the agent economy
is under CI against regression. Next strictly-required item before real value flows is **auth + USDC**
(4–5); the rest is direction-dependent.

See [`.claude/AUDIT.md`](../.claude/AUDIT.md) for the audit these items came from.
