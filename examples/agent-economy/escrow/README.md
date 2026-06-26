# Escrow — the optional smart-contract upgrade

> **This is an opt-in add-on, not part of the core track.** The base agent economy is TypeScript-only
> and settles with plain SOL transfers + Solana Pay verification — no custom on-chain program. This
> directory is the **smart-contract** version for people who want **trustless settlement**, and it
> introduces Rust (Anchor). Use it only if you need what it buys.
>
> **Status:** ✅ built, **deployed to devnet**, and tested. Program ID
> [`R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet`](https://explorer.solana.com/address/R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet?cluster=devnet).
> The 3 integration tests below pass against the live program (lifecycle + the two security
> constraints). Re-deploy your own with the steps below.

---

## Why escrow

The base loop is **pay-first**: the buyer pays, *then* trusts the seller to deliver. If the seller
takes the payment and delivers nothing, the buyer is out the money (the security review calls this the
"trust asymmetry"). That's fine for first-party / trusted agents; it does **not** scale to an open
marketplace of strangers.

Escrow flips it to **conditional settlement**:

```
buyer deposits SOL into a per-order escrow PDA      (funds locked on-chain)
seller delivers the service                          (off-chain, over CoralOS)
buyer releases  → seller is paid                     (buyer confirms delivery)
   …or…
deadline passes → buyer refunds                      (seller never delivered)
```

Neither side can cheat the protocol: the seller can't take funds without a release; the buyer can't
claw back funds before the deadline once a release happens.

---

## How it's built

```
escrow/
  programs/escrow/src/lib.rs   the Anchor program (initialize / release / refund)
  programs/escrow/Cargo.toml
  Anchor.toml
  client/escrow.ts             TypeScript client — deposit / release / refund
  tests/escrow.ts              integration tests (lifecycle + security) — run against devnet
  package.json
```

### The program (`lib.rs`)

| Instruction | Who signs | What it does |
|---|---|---|
| `initialize(amount, reference, deadline)` | buyer | Creates a per-order escrow PDA and deposits `amount` SOL into it |
| `release()` | buyer | Pays the escrowed `amount` to the seller; closes the escrow (rent → buyer) |
| `refund()` | buyer | After the `deadline`, returns the whole balance to the buyer |

The escrow PDA is seeded by `[b"escrow", buyer, reference]` — the **`reference`** is the same Solana
Pay key the seller already mints per request, so escrow slots into the existing protocol without a new
identifier.

### Security (from the solana-dev skill's checklist)

- **`init`, never `init_if_needed`** — no reinitialization attacks.
- **Per-(buyer, reference) PDA seeds** — no shared-PDA "master key" across orders.
- **`Signer` + `has_one = buyer` / `has_one = seller`** — only the bound parties can release/refund.
- **`close = buyer`** — secure closure returns rent and prevents account revival.
- **Checked math** on every lamport move.

---

## Build, test, deploy

Prereqs: Rust, the Solana CLI, and Anchor 0.32.x (`avm install 0.32.1 && avm use 0.32.1`). The
[`solana-dev`](../../../SKILLS.md) skill can set this up and help debug.

```sh
cd examples/agent-economy/escrow
anchor build                              # compiles the program + generates the IDL & TS types
anchor keys sync                          # set the program id to your keypair's
anchor deploy --provider.cluster devnet   # deploy (needs a funded devnet wallet)

# integration tests against the DEPLOYED program (no local validator needed):
npm install
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=$HOME/.config/solana/id.json \
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/escrow.ts
```

> **Windows note:** `anchor build` may emit the IDL but skip the `.so`. If `target/deploy/escrow.so`
> is missing, run `cd programs/escrow && cargo build-sbf` then
> `cp programs/escrow/target/deploy/escrow.so ../../target/deploy/` before `anchor deploy`.
> (Also in `TROUBLESHOOTING.md`.) For fast in-process unit tests, port `tests/escrow.ts` to **LiteSVM**.

---

## Wiring it into the agent flow

The drop-in change: where the buyer currently **transfers** SOL, it **deposits** into escrow instead,
and **releases** after it has the delivered data.

```ts
import { deposit, release } from './client/escrow'

// buyer-agent, instead of payFromUrl(...):
await deposit(program, buyer, sellerPubkey, reference, amountSol, /* deadline */ 600)
// → tell the seller "paid via escrow reference=<reference>"
// seller verifies the escrow PDA exists + is funded, then delivers
// buyer, once it has DELIVERED data:
await release(program, buyer, sellerPubkey, reference)
```

The seller-side check changes from "did a transfer land?" to "is there a funded escrow PDA for this
reference, with me as the seller?" — and it only delivers once it sees the deposit. (For a fully
trustless *delivery proof* you'd add an arbiter — see below.)

---

## What you could build on this

The escrow is the foundation; the interesting agent-economy mechanisms are built on top:

| Build | Idea |
|---|---|
| **Dispute / arbiter agent** | Add a third `arbiter` signer that can release-to-seller or refund-to-buyer when the two disagree — a reputation-staked agent that adjudicates delivery |
| **Milestone / streaming payments** | Multiple partial releases as a long task completes, instead of one lump sum — pay an agent as it makes progress |
| **Subscriptions** | A recurring escrow the seller can claim once per period while the buyer keeps it funded |
| **Multi-token settlement** | Escrow **USDC** (or any SPL / Token-2022) instead of SOL for price stability — swap `SystemProgram` transfers for `token_interface` transfers |
| **On-chain agent registry** | A PDA per agent storing identity, accepted tokens, and a **reputation** score — buyers check it before escrowing; releases/refunds update it |
| **x402 facilitator** | Make the program the on-chain verify/settle step of the HTTP 402 flow, replacing any trusted facilitator |
| **Slashing / staking** | Sellers stake into the program; failed deliveries (via the arbiter) slash the stake — Sybil resistance for an open marketplace |

Each of these is a hackathon project in its own right, and the `solana-dev` skill is set up to help
build them (Anchor scaffolding, LiteSVM tests, Codama client generation, the security checklist).

---

## The honest trade-off

- **Gain:** trustless settlement — the headline thing a real agent marketplace needs.
- **Cost:** it's **Rust**, so it breaks the kit's "TypeScript end-to-end" simplicity, and it adds a
  build/deploy toolchain. That's why it lives here as an opt-in, not in the core track.
- **Middle ground:** if you only want **price stability** (not trustlessness), you don't need a
  program at all — accept **USDC** via SPL token transfers in the existing TS flow. Escrow is
  specifically about *trust*, not tokens.
