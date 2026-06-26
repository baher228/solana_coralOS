# Troubleshooting

**First step, always:** run the readiness check — it diagnoses most of this and prints the fix.

```sh
just doctor          # or:  node scripts/doctor.js
```

---

## Setup & toolchain

### `node: command not found` (Windows, via `just`)
The justfile uses `cmd.exe` (`set windows-shell := ["cmd.exe", "/c"]`), which has the full PATH. If
you still hit it, reopen your terminal after installing Node, or run the manual README commands.

### `just` isn't installed
It's optional (`winget install Casey.Just`). Every recipe in the `justfile` is a one-liner you can copy.

### `Cannot find module '@solana/web3.js'` running setup/doctor
The `scripts/` deps aren't installed: `cd scripts && npm install`, then retry.

---

## Funding (the #1 hour-1 blocker)

### "Where are my wallet addresses?"
After `node scripts/setup.js` they're printed **and saved to `WALLETS.txt`**. Re-run it anytime to reprint.

### The faucet won't give me SOL / "rate limited"
[faucet.solana.com](https://faucet.solana.com) is the **only** way (CLI/RPC `airdrop` is gated). It
needs **GitHub sign-in** and rate-limits per account.
- Make sure you're signed in with GitHub.
- Request a small amount (1 SOL is plenty — a deposit is ~0.0002).
- Fund **both** the buyer and seller wallets; devnet SOL persists, so you only fund once.

### Agents start but the buyer never deposits / "insufficient funds"
The buyer wallet is empty. `just doctor` checks both balances — fund the one it flags (`WALLETS.txt`).

---

## Docker & the stack

### `Cannot connect to the Docker daemon` / coral exits immediately
Docker Desktop isn't running. Start it, wait, then `docker compose up -d coral`.

### coral is up but no agents appear
coral launches the agents as containers — they must be **built first**:
```sh
bash build-agents.sh        # or: just build
```
Check: `docker images | grep agent`. coral needs the Docker socket (mounted in `docker-compose.yml`).

### First round is slow
On the first session coral pulls/launches the agent containers — give it **~20 seconds**. Watch with
`docker compose logs -f coral`.

### Port `:5555` already in use
```sh
docker compose down
#   Windows:  netstat -ano | findstr :5555      macOS/Linux:  lsof -i :5555
```

---

## Agents, LLM & the market

### Sellers never bid
They need an LLM key — `ANTHROPIC_API_KEY` (or `LLM_PROVIDER=openai` + `OPENAI_API_KEY`) in `.env`,
forwarded to the agents. Without it `decideBid` falls back to a floor bid only if the hard guards pass;
check the key is set and the seller's `SERVICES` inventory includes `BUYER_SERVICE`.

### `NO_SELLERS` every round
No seller carries `BUYER_SERVICE` in its inventory, or none came online. Default `BUYER_SERVICE=coingecko`
is carried by `seller-cheap` + `seller-premium`. Give the session ~20s on first run.

### `DELIVERED` / `RELEASED` never comes back
Trace it: `docker compose logs -f coral`, or set `TRACE=1`. Common causes in order: wallets unfunded →
agent images not built → LLM key missing → escrow program unreachable (RPC) → the seller's upstream API down.

---

## Escrow contract

### `escrow IDL not found on-chain`
The agents fetch the IDL from the deployed program. The default `PROGRAM_ID`
(`R5NW…CeXet`) is on **devnet** — make sure `SOLANA_RPC_URL` points at devnet. If you redeployed your
own program, run `anchor keys sync` and update the id in the agents' `escrow.ts`.

### `anchor build` fails (only if you fork the contract)
Needs the Solana + Anchor toolchain (Anchor **0.32.x**). On Windows, if `target/deploy/escrow.so` is
missing after a build, run `cd programs/escrow && cargo build-sbf`. The contract is opt-in; the demo
runs against the already-deployed program with no build.

---

## Cleanup — orphaned agent containers

coral launches a fresh agent container per session and doesn't reap them, so they pile up:
```sh
just clean          # or: node scripts/clean.js   (only removes containers from the agent images)
```
A full reset: `docker compose down && just clean && docker compose up -d coral`.

---

## Still stuck?
Run `just doctor` and paste its output into an issue — it captures Node, Docker, wallet, and stack state.
