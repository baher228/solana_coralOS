# web — the React frontend (default demo UI)

A Vite + React + TypeScript + Solana wallet-adapter app — the polished front door to the agent
economy. It's the **default** UI: the bridge builds and serves it at `http://localhost:3010`.

Two tabs, both talking only to the bridge (never directly to CoralOS or Solana):

- **Autonomous** — click Run; watch an LLM buyer agent pay the seller on-chain, live.
- **Checkout** — connect Phantom (Devnet), pick a service, pay with one click, get the result.

## Develop (hot reload)
The served build is static, so for live edits run the Vite dev server (React Fast Refresh — edits to
any `.tsx`/`.css` update instantly) with the bridge up:
```sh
docker compose up -d coral bridge        # backend on :3010
just ui                                  # → http://localhost:5173, hot-reloading, proxied to the bridge
```
`just ui` is shorthand for `cd examples/agent-economy/web && npm install && npm run dev`. The dev
server proxies `/order`, `/autonomous`, and `/health` to the bridge on :3010, so the UI is live while
the agents/payments run against the real backend.

## Build
```sh
npm run build                            # → dist/  (what the bridge serves in production)
npm run typecheck
```

## How it's wired
- `src/api.ts` — typed client for the bridge endpoints (`/order`, `/order/:ref/paid`,
  `/autonomous/start`, `/autonomous/feed`).
- `src/main.tsx` — wallet providers (Phantom, devnet) + a `Buffer` polyfill for web3.js.
- `src/hooks/useCheckout.ts` — builds the reference-bound transfer, Phantom signs, submits the proof.
- `src/hooks/useFeed.ts` — polls the autonomous conversation.

The backend doesn't change — this is purely a nicer window onto the same economy. Full build notes:
[`docs/REACT_FRONTEND.md`](../../../docs/REACT_FRONTEND.md).
