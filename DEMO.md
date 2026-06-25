# Agent Economy Demo — What This Is

## The one-line pitch

A seller **agent** on Solana sells a service. A buyer — **another agent** or a **human** — pays for it
in SOL. The whole transaction — request, pay, verify, deliver — happens in seconds, on-chain, with no
human approving the payment (unless the human *is* the buyer, clicking once in Phantom).

---

## The problem this solves

Today, if software wants to pay for something it needs a credit card, an API key, a subscription, or a
human to approve a transaction. None of those work at machine speed, for $0.0001 micropayments, or
when the buyer is an AI agent with no bank account.

Solana fixes the rails: SOL settles in under a second, costs a fraction of a cent, and needs no human
identity. An agent can hold a wallet and transact with any other agent automatically. The stack that
makes it work:

| Layer | What it does |
|-------|-------------|
| **Solana** | Settlement — fast, cheap, final |
| **Solana Pay** | The payment-request standard — a `solana:` URL agents and wallets understand, with a **reference** key that binds a payment to one request |
| **HTTP 402** | "Payment Required" — services answer "pay me first" instead of "forbidden" |
| **CoralOS** | The agent coordination layer (MCP) — agents join sessions and message each other |

---

## What the demo actually is

**One seller agent, two front doors** — the same `request → PAYMENT_REQUIRED → paid → DELIVERED`
protocol either way:

### Front door 1 — Autonomous (agent → agent)
A **buyer agent** asks the seller for a service, parses the Solana Pay URL, **pays 0.0001 SOL on
devnet**, sends the proof, and gets the data — then optionally summarizes it with Claude. You watch it
in `docker logs`; each cycle prints a real transaction signature.

### Front door 2 — Human checkout (Phantom)
A person opens the bridge UI, picks a service, and clicks **Request & Pay**. The bridge injects the
order into the *same* CoralOS seller (as the `user-proxy` stand-in); Phantom signs the transfer; the
seller verifies on-chain and delivers — shown live in the browser.

The seller doesn't know or care whether the buyer is an agent or a human. Same protocol, same
on-chain settlement.

---

## The full flow

```
buyer (agent OR human) ── "request <service>" ──▶ seller agent
seller ── "PAYMENT_REQUIRED reference=<R> amount=0.0001 url=solana:…" ──▶ buyer
buyer  ── pays 0.0001 SOL on devnet, writing reference R into the transfer ──▶ chain
buyer  ── "paid <sig> reference=<R>" ──▶ seller
seller ── validateTransfer(sig): recipient + amount + reference all match? ──▶ on-chain check
seller ── "DELIVERED {…live data…}" ──▶ buyer
```

Every line is a real message over a CoralOS thread; the payment in the middle is a real devnet
transaction you can open in [Solana Explorer](https://explorer.solana.com/?cluster=devnet). Verification
is on-chain — no off-chain trust. The payment is **reference-bound**, so a proof can't be stolen or
reused for another order.

---

## Why this is agentic

An agent is agentic when it can **perceive**, **decide**, and **act** with no human in the loop:

| Step | Who does it |
|------|-------------|
| Seller generates the payment request | Seller agent |
| Buyer evaluates the price and decides to pay | Buyer agent (an LLM, with a code-enforced budget) |
| Buyer signs + broadcasts the transaction | Buyer agent |
| Seller verifies the payment on-chain | Seller agent |
| Seller delivers the service | Seller agent |

In the autonomous front door, **every** step is the agents. In the human front door, the only human
action is the one-click Phantom approval.

---

## The fork point — what the seller sells

The demo seller returns a live **Jupiter swap quote** by default. Change one function and it sells
anything:

```ts
// coral-agents/seller-agent/src/service.ts
export async function deliverService(request: string) {
  // ← your service here
}
```

| What the seller sells | What the buyer gets |
|----------------------|--------------------|
| Jupiter swap quote (default) | `{"pair":"SOL→USDC","outAmount":"65.87 USDC"}` |
| CoinGecko price | `{"solana":{"usd":189.42}}` |
| Claude inference | an AI completion |
| Your API / data / compute | whatever you return |

Built-ins via the `SERVICE` env: `jupiter | coingecko | news | inference`.

---

## Run it

```sh
node scripts/setup.js                              # generate + fund devnet wallets
bash build-agents.sh                               # build the agent images
docker compose up -d coral bridge                  # coral-server + the checkout bridge

cd examples/agent-economy/autonomous && npm start  # autonomous (watch: docker logs -f buyer-agent)
# open http://localhost:3010                        # human checkout (Phantom on Devnet)
```

No Docker? `examples/agent-economy/quickstart/` is the same loop as two bare-metal Node processes
over plain HTTP 402.

---

## The stack in this repo

| Directory | What it is |
|-----------|-----------|
| `examples/agent-economy/` | The track — autonomous starter, the human bridge + Phantom checkout UI, the no-Docker quickstart |
| `coral-agents/` | The agents coral-server launches — `seller-agent` (fork `service.ts`), `buyer-agent` (autonomous + LLM), `echo-agent`, `user_proxy` |
| `packages/agent-runtime/` | TypeScript agent runtime — `AgentManager`, strategies, the CoralOS MCP client, Solana Pay logic |

---

## Status

Proven live on devnet (gates G1–G3 in `.claude/AGENT_ECONOMY_RESTRUCTURE.md`): coral-server boots
wallet-free, the autonomous loop settles on-chain, and the human checkout delivers. Hardened:
reference-bound payments, replay protection, payment-path tests, CI, and a mainnet guard
(`.claude/SECURITY_REVIEW.md`, `docs/PRODUCTION_HARDENING.md`).
