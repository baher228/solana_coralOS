# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

A TypeScript-first monorepo for a Solana agent-economy starter kit. Agents request, pay, and settle on-chain automatically using Solana Pay. CoralOS coordinates multi-agent sessions. The stack is Node.js throughout — no Rust, no Cargo.

## Repo Layout

| Directory | Purpose |
|-----------|---------|
| `examples/agent-economy/` | **The track.** `autonomous/` (agent↔agent starter), `bridge/` (human→user-proxy Phantom front door), `config/coral.toml` (wallet-free MCP config), `quickstart/` (no-Docker bare-metal 402) |
| `coral-agents/` | Agents coral-server launches: `seller-agent` (fork `service.ts`), `buyer-agent`, `echo-agent` (TypeScript); `user_proxy` (Python — the human's session stand-in, driven via the puppet API) |
| `api-server/` | Express REST API — secondary server (port 8081) |
| `packages/agent-runtime/` | TypeScript agent runtime: `AgentManager`, `Strategy`, `MessageBus`, `SharedState`, `WorkflowEngine`, CoralOS MCP client, Solana Pay strategies |
| `packages/coral-client/` | `CoralClient` — typed HTTP wrapper for `api-server/` |
| `web/` | Next.js marketplace UI — Phantom wallet flow (port 3000) |
| `docs/`, `.claude/` | Design documents + the `AGENT_ECONOMY_RESTRUCTURE.md` plan (gates G1–G3) |
| `e2e/` | Playwright end-to-end tests |

The headline path is `examples/agent-economy/` on stock coral-server. CoralOS is the MCP
coordination layer only — payments settle agent-side in SOL (no coral-server wallet, no native x402).

## Commands

### api-server (primary server)

```sh
cd api-server && npm install   # once
cd api-server && npm run dev   # dev server on :8081 with hot reload
cd api-server && npm test      # unit tests
cd api-server && npm run typecheck
```

### packages/agent-runtime (agent runtime)

```sh
cd packages/agent-runtime && npm install
cd packages/agent-runtime && npm run typecheck
cd packages/agent-runtime && npm test
```

### web (Next.js)

```sh
cd web && npm install
cd web && npm run dev      # :3000, points at api-server :8081 by default
cd web && npm run build
```

### coral-agents (TypeScript + one Python utility, requires Docker)

```sh
# TypeScript agents (built from repo root so they can bundle packages/):
bash build-agents.sh seller   # seller-agent:0.1.0
bash build-agents.sh buyer    # buyer-agent:0.1.0
cd coral-agents/user_proxy && docker build -t user-proxy:0.1.0 .   # Python test puppet
# Then start CoralOS: docker compose --profile coral up
```

## Architecture

### packages/agent-runtime

The central TypeScript library. Key modules:

- **`agent.ts` / `AgentState`** — agent holds a pluggable `Strategy` and action log
- **`manager.ts` / `AgentManager`** — creates, stores, drives agents; owns `MessageBus`, `SharedState`, `WorkflowEngine`
- **`strategy.ts` / `BaseStrategy`** — `async run(state, signal)` + `handleMessage(text, state)` interface
- **`message_bus.ts`** — broadcast/direct messaging between agents
- **`shared_state.ts`** — versioned key-value store accessible to all agents
- **`workflow.ts`** — DAG of `WorkflowStep`s with dependency ordering
- **`coral_mcp.ts`** — MCP client for joining CoralOS sessions
- **`strategies/`** — `HeliusMonitorStrategy`, `TransferStrategy`, `PaymentStrategy`, `WeatherStrategy`, `IdleStrategy`

### api-server

Express server exposing `packages/agent-runtime` over HTTP at `/api/v1/`:
- `/agents` — CRUD + start/stop/handle
- `/shared-state` — key-value read/write
- `/messages` — message bus
- `/weather` — demo paid endpoint

### web

Next.js 14 marketplace. Connects to `api-server` via `NEXT_PUBLIC_CORAL_SERVER` (default `http://localhost:8081`).

### coral-agents (CoralOS)

`buyer-agent`, `seller-agent`, `echo-agent` — TypeScript agents (built on `packages/agent-runtime`).  
`user_proxy` — Python puppet agent; lets the Puppet API inject test messages into a CoralOS session.

(On-chain wallet monitoring lives in the TypeScript `HeliusMonitorStrategy` in `packages/agent-runtime`.)

## Key Constraints

- **`Strategy.run()` must respect the `AbortSignal`** — check `signal.aborted` in polling loops and return cleanly.
- **`AgentManager` is not thread-safe across Node.js workers** — keep it in the main process; use message passing if you need workers.
- **CoralOS requires Docker** — coral-agents are launched as Docker containers by the CoralOS server. Build images before running `--profile coral`.
- **Devnet only** — all Solana operations target devnet. Never use a funded mainnet keypair in `.env`.
