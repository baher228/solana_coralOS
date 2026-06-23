# Agent Economy Demo — What This Is

## The one-line pitch

Two agents on Solana. One sells data. One buys it. No human approves the payment. The whole transaction — request, pay, deliver — happens in seconds, on-chain, using stablecoins or SOL.

---

## The problem this solves

Today, if software wants to pay for something it needs a credit card, an API key, a subscription, or a human to approve a transaction. None of those work at machine speed. None of them work for micropayments of $0.001. None of them work when the buyer is an AI agent with no bank account.

Solana fixes the rails. SOL and stablecoins on Solana settle in under a second, cost fractions of a cent in fees, and require no human identity. An agent can hold a wallet, receive and send funds, and transact with any other agent or service on the network — automatically, continuously, at scale.

The stack that makes this possible:

| Layer | What it does |
|-------|-------------|
| **Solana** | The settlement layer — fast, cheap, final |
| **Solana Pay** | The payment request standard — a `solana:` URL that wallets and agents understand |
| **Helius** | The data layer — monitors wallets, parses transactions, confirms payments in real time |
| **x402 / MPP** | The HTTP payment protocol — APIs that return "402: pay me first" instead of "403: forbidden" |
| **CoralOS** | The agent coordination layer — agents talk to each other, share state, run workflows |
| **Pay.sh** | The client that handles the 402 challenge automatically — wraps any CLI tool |

This app demonstrates all of these working together.

---

## What the app actually is

A desktop app (Tauri — Rust backend, React frontend) that runs a live multi-agent system. You can see the agents, watch what they are doing in real time, and trigger the full payment flow from request to confirmation.

It has two core demo agents:

---

### Agent 1 — The Seller (Solana Pay Agent)

This agent represents a service that wants to be paid before it delivers anything.

**What it does:**
- Holds a devnet wallet address
- Generates a Solana Pay URL: `solana:ADDRESS?amount=0.001&label=DataFeed`
- That URL is a machine-readable payment request — any wallet or agent that understands the Solana Pay spec can read it and send the exact right amount to the exact right address
- Waits for confirmation that payment arrived
- Once confirmed: delivers whatever it is selling (in the demo: a data response logged as an action)

**Why this matters:** Any API, any data feed, any compute service can become agent-accessible by adding this one step. No subscriptions. No API keys. No account setup. An agent with a wallet can just pay and get access.

---

### Agent 2 — The Buyer (Helius Monitor Agent)

This agent represents a buyer that wants data and is willing to pay for it automatically.

**What it does:**
- Connects to Helius on Solana devnet
- Polls the seller's wallet address every 10 seconds: *"has anyone paid yet?"*
- When it detects an incoming transfer that matches the expected amount, it fires immediately:
  - Logs the transaction signature
  - Logs who paid, how much, and when
  - Triggers the next step (request the data from the seller)

**Why this matters:** This is the confirmation engine. It closes the loop. The buyer agent knows the payment landed without asking a human, without polling a database, without waiting for an email. It just watches the chain.

---

## The full flow — what you actually see

```
┌─────────────────────────────────────────────────────────┐
│  SELLER AGENT (Panel A)         BUYER AGENT (Panel B)   │
│                                                         │
│  Address: 7xK...f9              Watching: 7xK...f9      │
│  Amount:  0.001 SOL             Expecting: 0.001 SOL    │
│                                                         │
│  URL: solana:7xK...f9           ● POLLING every 10s     │
│       ?amount=0.001             Last check: 2s ago      │
│       &label=DataFeed           Payments seen: 0        │
│                                                         │
│  ── Actions ──────────          ── Actions ─────────    │
│  12:01:03 url-generated         12:01:10 poll-tick      │
│  12:01:03 waiting for payment   12:01:20 poll-tick      │
│                                 12:01:30 poll-tick      │
│                                                         │
│  [User sends 0.001 SOL to the address from any wallet]  │
│                                                         │
│  12:01:38 payment-confirmed     12:01:38 payment-received│
│  sig: 3xK...ab                  sig: 3xK...ab           │
│  12:01:38 delivering data       from: 9mZ...11          │
│  → {"price": 189.42}            amount: 0.001 SOL       │
└─────────────────────────────────────────────────────────┘
```

Both panels are live. Both update in real time. No human approved the payment step — the buyer agent detected it and the seller agent responded.

---

## Why this is agentic

An agent is agentic when it can **perceive**, **decide**, and **act** without a human in the loop.

| Step | What happens | Who does it |
|------|-------------|-------------|
| Seller generates payment request | `solana:` URL created | Seller agent |
| Buyer receives the request | Parses the URL | Buyer agent |
| Buyer sends payment | Signs and broadcasts tx | Buyer agent (or demo user) |
| Payment confirmed | Helius detects it on-chain | Helius + Buyer agent |
| Seller delivers data | Response triggered by confirmation | Seller agent |

The only human action in the demo is the initial "send payment" step — which in a real deployment would also be automated. The agents handle everything else.

---

## How this fits the hackathon

The Agent Economy hackathon (Superteam UK × Plugged, June 1–6 2026) is built around one thesis:

> *Agents are the next category of customer for payments infrastructure. They transact at machine speed, in micro-amounts, with no human in the loop.*

The three bounty tracks are:

**Track 1 — Agents serving agents.**
One agent pays another for a service. This demo fits here. The seller agent exposes a service. The buyer agent consumes it. Payment is automatic, on-chain, in SOL.

**Track 3 — Agent-accessible services.**
Building an API or data service that agents can pay for. The seller agent in this demo is exactly that — a service endpoint priced per-request, accessible to any agent with a Solana wallet.

This demo covers both tracks. It is not a concept — it is a working implementation of the exact thing the event is about.

---

## What this could become

The demo uses a hardcoded response ("deliver data"). But the seller agent can deliver anything:

| What the seller sells | What the buyer gets |
|----------------------|-------------------|
| Stock price feed | `{"AAPL": 189.42}` |
| Weather data | `{"London": "18°C, cloudy"}` |
| AI inference result | `{"sentiment": "positive"}` |
| Compute units | A task executed on remote hardware |
| Access token | A time-limited credential to a private API |

Every one of these is a real use case. Every one of them works with the same payment rail this demo implements. The only thing that changes is what goes into the seller's "deliver" action.

---

## The stack in this repo

| Directory | What it is |
|-----------|-----------|
| `agent_demo/agent-core/` | Rust library — agent lifecycle, roles, messaging, workflows, Solana Pay logic |
| `agent_demo/src-tauri/` | Rust Tauri backend — IPC commands, CoralOS client |
| `agent_demo/src-ui/` | React frontend — live agent panels, action feeds |
| `coral-server/` | Standalone Axum REST API exposing the same agent runtime over HTTP |
| `agent_demo/agent-core/src/helius.rs` | Helius REST client — parsed transactions, balances |
| `agent_demo/agent-core/src/solana_pay/` | Solana Pay URL encoding/parsing, validation, payment strategies |

---

## Status: fully implemented

All components described in this document are implemented and working:

- `TritonPaymentMonitorStrategy` — real-time WebSocket account monitoring via Helius devnet
- Helius devnet endpoints (`https://devnet.helius-rpc.com/?api-key=...`)
- Seller agent delivers data via pay.sh after payment confirmed on-chain
- Two-panel Pay Demo tab in the UI showing both agents live with action feeds
- Payment flow debugger showing the full request → 402 → payment → delivery sequence
- Web frontend mode via `cargo run` + `npm run dev` (no Tauri required)
- TypeScript agent runtime in `typescript_sdk/agent-core-ts/` (identical concepts to Rust)
- HTTP SDK in `typescript_sdk/sdk/` for calling coral-server from any JS/TS project
