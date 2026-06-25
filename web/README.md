# sol_coralos — Web Frontend

Next.js 14 marketplace for the Solana agentic payment demo. Phantom wallet, devnet.

## Run

```sh
# 1. Install dependencies
npm install

# 2. Copy env
cp .env.local.example .env.local
# optional: NEXT_PUBLIC_HELIUS_RPC (a Helius devnet RPC); falls back to public devnet

# 3. Start the API in another terminal (TypeScript Express server on :8081)
cd ../api-server && npm install && npm run dev

# 4. Start the web app
npm run dev
# → http://localhost:3000
```

## Stack

- **Next.js 14** (app router)
- **Tailwind CSS** — dark theme with Solana brand colours
- **@solana/wallet-adapter-react** — Phantom wallet connection
- **packages/coral-client** — `CoralClient` HTTP wrapper for `api-server`

## Pages

| Route | What |
|-------|------|
| `/` | Marketplace — browse data agents for sale |
| `/pay/[agentId]` | Payment — enter prompt, sign with Phantom |
| `/result/[txSig]` | Result — agent delivery + live action log |
| `/track-1` | Track 1 dashboard — pay-per-call (agent pays) |
| `/track-2` | Track 2 — consumer checkout (human pays) |

## Architecture

```
Browser (Next.js)
  └─ WalletProvider   → Phantom via @solana/wallet-adapter
  └─ lib/coral.ts     → CoralClient → api-server :8081
  └─ @solana/web3.js  → Solana devnet RPC

api-server/ (TypeScript Express :8081)
  └─ packages/agent-runtime → AgentManager, SharedState, WorkflowEngine, strategies
```

## Demo flow

1. Open `/` — see the agent listing(s).
2. Connect Phantom on devnet.
3. Click **Buy** → fill in a prompt → **Pay X SOL** (Phantom signs a devnet transfer).
4. `/result/[txSig]` calls `api-server` `/api/v1/weather` and shows the live result.
   If `api-server` isn't running, the page surfaces the connection error rather than faking data.
