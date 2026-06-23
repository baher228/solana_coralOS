# Skills — Coral Protocol + Solana

This repo ships with two external skill sets as git submodules under `skills/`. They extend Claude Code with commands and knowledge specific to CoralOS multi-agent workflows and Solana development.

---

## Table of Contents

- [Quick Install](#quick-install)
- [Coral Protocol Skills](#coral-protocol-skills)
- [Solana Dev Skill](#solana-dev-skill)
- [Using Skills in This Project](#using-skills-in-this-project)
- [Anchor Integration](#anchor-integration)

---

## Quick Install

```sh
# Pull skill submodules after cloning this repo
git submodule update --init --recursive

# Install Coral skills into Claude Code (run inside Claude Code terminal)
/plugin marketplace add Coral-Protocol/coral-skill-set

# Install Solana dev skill (run in any terminal)
npx skills add https://github.com/solana-foundation/solana-dev-skill
```

---

## Coral Protocol Skills

**Source:** `skills/coral-skills/` (submodule → https://github.com/Coral-Protocol/coral-skill-set)

Adds five Claude Code slash commands for working with CoralOS multi-agent sessions.

### Installation

Inside Claude Code:

```
/plugin marketplace add Coral-Protocol/coral-skill-set
/reload-plugins
```

### Commands

| Command                         | What it does                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `/coral-setup`                | Install and configure a local CoralOS server into`~/.coral/coral-server`             |
| `/coral-built-in-agent-setup` | Add pre-built agents (Claude Code, Hermes, Puppet) to a CoralOS session                |
| `/coralize-your-agent`        | Connect your existing agent project to CoralOS (supports Mastra and custom frameworks) |
| `/coral-agent-swarm`          | Orchestrate a multi-agent session — spawn agents, send tasks, collect results         |
| `/coral-encyclopedia`         | Query CoralOS concepts, API reference, and agent development patterns                  |

### How it applies to this repo

- Use `/coral-setup` to start the CoralOS Docker container that provides `CORAL_CONNECTION_URL`
- Use `/coral-built-in-agent-setup` to add the Puppet agent (user proxy) alongside your Rust/TypeScript agents
- Use `/coral-agent-swarm` to orchestrate the Seller + Buyer + Helius Monitor agents in a full demo session
- Use `/coralize-your-agent` if you fork this repo and want to add a new custom agent to the swarm

### Connection to this codebase

| Coral Skill              | This Repo                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `/coral-setup`         | Starts the server that provides`CORAL_CONNECTION_URL` used by `agent_demo/coral-agents/`                     |
| `/coral-agent-swarm`   | Drives the`CoralMcpSession` in `agent-core/src/coral_mcp.rs` and `typescript_sdk/agent-core-ts/src/coral_mcp.ts` |
| `/coralize-your-agent` | Connects a new strategy implementation to`POST /api/v1/coralos/mcp/join` in coral-server                       |

---

## Solana Dev Skill

**Source:** `skills/solana-skill/` (submodule → https://github.com/solana-foundation/solana-dev-skill)

Adds Solana ecosystem knowledge and tooling to Claude Code — SDK usage, Anchor programs, testing, token extensions, and payments.

### Installation

```sh
npx skills add https://github.com/solana-foundation/solana-dev-skill
```

Or clone manually:

```sh
git clone https://github.com/solana-foundation/solana-dev-skill skills/solana-skill
```

### What it adds

| Category                    | Tools / Knowledge                                                        |
| --------------------------- | ------------------------------------------------------------------------ |
| **Frontend**          | `@solana/kit` (v5.x), `@solana/web3-compat`, React wallet hooks      |
| **Program dev**       | Anchor framework, Pinocchio (high-performance programs)                  |
| **Testing**           | LiteSVM (unit tests), Mollusk, Surfpool (integration with mainnet state) |
| **Client generation** | Codama IDL → type-safe TypeScript clients                               |
| **Tokens**            | Token-2022 extensions, confidential transfers (ZK proofs)                |
| **Payments**          | Commerce Kit (checkout flows), Solana Pay integration                    |
| **Security**          | Vulnerability patterns, pre-deployment checklists                        |

### How it applies to this repo

| Solana Skill     | Where it helps                                                                      |
| ---------------- | ----------------------------------------------------------------------------------- |
| Anchor framework | Write a custom escrow program for trustless agent-to-agent payments                 |
| `@solana/kit`  | Upgrade`typescript_sdk/agent-core-ts` from legacy `@solana/web3.js` to the modern kit |
| LiteSVM          | Unit-test`agent-core/src/solana_pay/` strategies without a live devnet            |
| Commerce Kit     | Add a checkout flow to`agent_demo/src-ui` so humans can pay agents from a browser |
| Token-2022       | Accept USDC or other SPL tokens as payment instead of native SOL                    |
| Codama           | Auto-generate TypeScript types from a custom Anchor program IDL                     |

---

## Using Skills in This Project

### Start a full demo session with skills

```sh
# 1. Start CoralOS
/coral-setup

# 2. Start coral-server (Rust agents)
cd coral-server && cargo run

# 3. Start the UI
cd agent_demo/src-ui && npm run dev

# 4. Open Claude Code and launch the swarm
/coral-agent-swarm
# → CoralOS spawns Seller agent, Buyer agent, Helius Monitor
# → Agents join via CORAL_CONNECTION_URL
# → Seller generates Solana Pay URL
# → Buyer pays, Helius detects payment, Seller delivers
```

### Write a new Anchor program with skill assistance

After installing the Solana dev skill, Claude Code will automatically activate Anchor knowledge when you ask:

```
"Create an Anchor escrow program for agent-to-agent payments"
"Write a test for the escrow program using LiteSVM"
"Generate TypeScript client types from my Anchor IDL"
```

The program would live at `programs/escrow/src/lib.rs` and plug into `agent-core/src/solana_pay/` as an `AnchorEscrowStrategy`.

---

## Anchor Integration

Anchor is the standard framework for writing Solana programs. In this repo it enables:

### Escrow payments (trustless)

Instead of buyer sending SOL directly to seller (which requires trust), an Anchor escrow program holds funds until delivery is confirmed:

```
Buyer → depositFunds(escrow PDA) → funds locked on-chain
Seller → claimFunds(escrow PDA)  → funds released atomically with delivery
```

New files this would add:

```
programs/
  escrow/
    src/lib.rs          ← Anchor program (deposit, claim instructions)
    Cargo.toml

agent_demo/agent-core/src/
  anchor_escrow.rs      ← Rust instruction builders

typescript_sdk/agent-core-ts/src/strategies/
  anchor_escrow.ts      ← TypeScript strategy using @coral-xyz/anchor
```

The `HeliusMonitorStrategy` already watches account changes — point it at the escrow PDA instead of a plain wallet to detect deposits.

### On-chain agent registry

An Anchor PDA that stores:

- Agent public key
- Agent role (`Seller`, `Buyer`, `Monitor`)
- Reputation score
- Accepted payment tokens

Any agent can verify another agent's on-chain identity before transacting.

### x402 facilitator

An Anchor program that acts as the verify/settle step for the x402 HTTP 402 payment protocol — replacing the centralised facilitator with a trustless on-chain program.

---

## Submodule Reference

| Path                     | Repo                                   | Purpose                                 |
| ------------------------ | -------------------------------------- | --------------------------------------- |
| `skills/coral-skills/` | `Coral-Protocol/coral-skill-set`     | Claude Code skills for CoralOS          |
| `skills/solana-skill/` | `solana-foundation/solana-dev-skill` | Solana SDK + Anchor + testing knowledge |

To update skills to latest:

```sh
git submodule update --remote skills/coral-skills
git submodule update --remote skills/solana-skill
```
