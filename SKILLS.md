# Skills — Coral Protocol + Solana

Two optional Claude Code skill sets that extend the IDE with commands and knowledge specific to CoralOS multi-agent workflows and Solana development. Install them directly — no submodules needed.

---

## Table of Contents

- [Coral Protocol Skills](#coral-protocol-skills)
- [Solana Dev Skill](#solana-dev-skill)
- [Using Skills in This Project](#using-skills-in-this-project)
- [Anchor Integration](#anchor-integration)

---

## Coral Protocol Skills

Install inside Claude Code — run these three as slash commands:

```
/plugin marketplace add https://github.com/Coral-Protocol/coral-skill-set
/plugin install coral-skills@coral-skill-set
/reload-plugins
```

> Use the full **HTTPS URL** as shown. The `owner/repo` shorthand resolves to an SSH clone
> (`git@github.com:…`), which fails if you don't have GitHub SSH keys set up. The repo is public, so
> the HTTPS URL needs no auth.

Adds slash commands for working with CoralOS multi-agent sessions.

### Commands

| Command | What it does |
|---------|-------------|
| `/coral-setup` | Start, stop, inspect, and configure Coral Server |
| `/coral-runtime-reference` | The current machine-readable Coral API/schema reference |
| `/coral-session-control` | Operate Coral sessions via REST, Puppet, events, and extended state |
| `/coralize-your-agent` | Link or wrap a developer-owned agent for Coral discovery |
| `/coral-built-in-agent-setup` | Copy and verify packaged example agent templates |
| `/coral-app-integration` | Identify app, conductor, Cloud Console, and deployment boundaries |
| `/coral-coordination-topologies` | Map communication-topology vocabulary onto Coral session primitives |

### How it applies to this repo

| Coral Skill | This Repo |
|-------------|-----------|
| `/coral-setup` | Starts the coral-server this kit connects to — provides `CORAL_CONNECTION_URL` to `coral-agents/` |
| `/coral-session-control` | Drives sessions/threads via the **same REST + Puppet API** that `examples/agent-economy/bridge/` and `autonomous/start.ts` use |
| `/coral-runtime-reference` | The API/schema reference behind `packages/agent-runtime/src/coral_mcp.ts` |
| `/coralize-your-agent` | Wire a new agent into the economy (fork point: `coral-agents/`) |

- Use `/coral-built-in-agent-setup` to add the Puppet (`user-proxy`) agent alongside your TypeScript agents
- Use `/coralize-your-agent` when you fork and want to wire a new custom agent in

---

## Solana Dev Skill

```sh
# project-level (vendors the skill into the current repo):
npx skills add https://github.com/solana-foundation/solana-dev-skill

# or user-level (available in every project, nothing committed) — recommended:
npx skills add https://github.com/solana-foundation/solana-dev-skill --global --yes
```

Installed via the [`skills`](https://github.com/vercel-labs/skills) CLI (vercel-labs). It symlinks
into Claude Code (and other agents) and runs a safety scan on install. Adds Solana ecosystem
knowledge and tooling — SDK usage, Anchor programs, testing, token extensions, and payments.

### What it adds

| Category | Tools / Knowledge |
|----------|------------------|
| **Frontend** | `@solana/kit` (v5.x), `@solana/web3-compat`, React wallet hooks |
| **Program dev** | Anchor framework, Pinocchio (high-performance programs) |
| **Testing** | LiteSVM (unit tests), Mollusk, Surfpool (integration with mainnet state) |
| **Client generation** | Codama IDL → type-safe TypeScript clients |
| **Tokens** | Token-2022 extensions, confidential transfers (ZK proofs) |
| **Payments** | Commerce Kit (checkout flows), Solana Pay integration |
| **Security** | Vulnerability patterns, pre-deployment checklists |

### How it applies to this repo

| Solana Skill | Where it helps |
|--------------|---------------|
| Anchor framework | Write a custom escrow program for trustless agent-to-agent payments |
| `@solana/kit` | Upgrade `packages/agent-runtime` from legacy `@solana/web3.js` to the modern kit |
| LiteSVM | Unit-test `packages/agent-runtime/src/strategies/` without a live devnet |
| Commerce Kit | Polish the bridge's Phantom checkout (`examples/agent-economy/bridge/web`) |
| Token-2022 | Accept USDC or other SPL tokens as payment instead of native SOL |
| Codama | Auto-generate TypeScript types from a custom Anchor program IDL |

---

## Using Skills in This Project

### Start a full demo session with skills

```sh
# 1. Start coral-server (the skill helps you configure it)
/coral-setup
docker compose up -d coral

# 2. Launch the autonomous economy (agent → agent)
cd examples/agent-economy/autonomous && npm install && npm start
# → coral spawns seller-agent + buyer-agent
# → buyer requests → seller replies with a Solana Pay URL
# → buyer pays on devnet → seller verifies on-chain (getTransaction) → delivers

# 3. Inspect the live session with the skill
/coral-session-control     # read threads, messages, and extended state
```

### Write a new Anchor program with skill assistance

After installing the Solana dev skill, Claude Code will automatically activate Anchor knowledge when you ask:

```
"Create an Anchor escrow program for agent-to-agent payments"
"Write a test for the escrow program using LiteSVM"
"Generate TypeScript client types from my Anchor IDL"
```

The program would live at `programs/escrow/src/lib.rs` and plug into `packages/agent-runtime/src/strategies/` as an `AnchorEscrowStrategy`.

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

packages/agent-runtime/src/strategies/
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
