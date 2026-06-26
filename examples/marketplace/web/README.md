# Marketplace visualizer

A read-only React app that renders the live auction — each round's `WANT`, the competing LLM bids
(winner highlighted, self-selected sellers shown as declined), the buyer's reasoning, and the on-chain
escrow settlement with clickable devnet Explorer links. It watches agents transact; there's no human
buyer and **no wallet** — fully on-thesis.

```
 web/ (React, this app) ──poll──▶ feed/ (Express) ──read──▶ coral session transcript
```

## Run

```sh
just dev          # builds, starts coral, opens the dashboard — then click "Start a market"
# or, if coral is already up:
just dashboard    # feed + UI on :5173, opens the browser
```

The **Start a market** button asks the feed server (`POST /api/start`) to launch a session and then
watches it live — fund your wallets first. (Logs-flow alternative: `just market`, then paste the
printed session id into the input.)

## How it works

The browser never touches coral or Solana. The **feed server** reads the session's extended state,
folds the transcript into typed `Round`s with `foldRounds` — which **reuses `@pay/agent-runtime`'s own
parsers**, so the wire protocol has one source of truth — and serves CORS-enabled JSON the app polls.

## Test (no devnet, no LLM key)

```sh
cd examples/marketplace/web
npm test          # Vitest + Testing Library — component rendering (bids/winner/links)
npm run e2e       # Playwright — the REAL feed server folding a recorded coral transcript → real app
cd ../feed && npm test   # foldRounds + collectMessages verified against the same real transcript
```

The e2e is **not** a route mock: Playwright starts the real feed server with a recorded CoralOS
extended-state response (`feed/tests/coral-session.json`, captured from a settled devnet round), so it
exercises the actual `collectMessages → foldRounds → HTTP → UI` path. The only thing replaced is coral
itself — which makes it deterministic and CI-friendly with no devnet or LLM key.

## Fork points

| Want… | Edit |
|-------|------|
| a new bid field (eta, reputation) | `src/components/BidRow.tsx` + the `Round` type + `../feed/src/foldRounds.ts` |
| a different look | `src/components/RoundCard.tsx` + `src/styles.css` |
| live push instead of polling | swap `useFeed`'s `setInterval` for an SSE endpoint on the feed server |
| let a human fund/settle (advanced) | add wallet-standard via framework-kit — see the `solana-dev` skill |

See [`docs/MARKETPLACE_FRONTEND.md`](../../../docs/MARKETPLACE_FRONTEND.md) for the full design.
