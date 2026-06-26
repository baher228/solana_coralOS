# Plan: a forkable, e2e-tested React frontend for the marketplace

> **Goal:** a **read-only live market visualizer** — a React app that renders the auction as it
> happens: each `WANT`, the competing LLM bids racing in, the award (with the buyer's reasoning), and
> the on-chain escrow settlement with clickable Explorer links. On-thesis (it observes agents
> transacting — there's no human buyer, no wallet in the core), idiomatic, and **e2e-tested with
> fixtures so it runs in CI without devnet**.

This is deliberately *not* the old checkout UI. The human isn't a market participant — they're a
spectator watching machines compete. That keeps it aligned with "agents are the customer."

---

## What it shows (grounded in the real transcript)

A live run produces exactly these messages in the CoralOS session thread (verified on devnet):

```
WANT round=1 service=coingecko arg=SOL-USDC budget=0.001
BID  round=1 price=0.0005 by=seller-premium note=available
BID  round=1 price=0.0002 by=seller-cheap   note=available
AWARD round=1 to=seller-premium
ESCROW_REQUIRED round=1 reference=DKQy… seller=7jw… amount=0.0005 deadline=600
DEPOSITED round=1 reference=DKQy… buyer=47Dp… sig=5syz…
DELIVERED round=1 {"coin":"solana","usd":72.33,…}
RELEASED round=1 sig=3PMa…
```

The UI folds these into one **Round** card per round: the need, the bids (winner highlighted), the
delivered data, and the deposit/release **Explorer links**. `seller-lazy` staying silent shows as a
"declined" row — self-selection made visible.

---

## Architecture — two small pieces

```
 React app (Vite)  ──poll──▶  feed server (Express)  ──read──▶  coral-server /…/extended
 examples/marketplace/web/      examples/marketplace/feed/        (session transcript)
```

**Why a feed server (not browser → coral directly):** the transcript lives in coral's session
*extended state*, behind the dev auth token, with no CORS for browsers. A ~60-line Express proxy reads
it server-side and exposes a clean, CORS-enabled JSON feed. It also keeps the token out of the browser.

The feed server is the *only* new backend, and it's tiny. The React app never touches coral or Solana.

---

## The data model + protocol reuse (the idiomatic core)

**Reuse `@pay/agent-runtime`'s parsers** — the wire protocol has one source of truth. The feed server
(or a shared util) folds raw messages into typed rounds with a **pure reducer**:

```ts
// foldRounds.ts — pure, unit-testable, reuses parseWant/parseBid/parseAward/… from @pay/agent-runtime
export interface Round {
  round: number
  want?: { service: string; arg: string; budgetSol: number }
  bids: { by: string; priceSol: number; note?: string }[]
  declined: string[]                       // sellers who were @mentioned but didn't bid
  award?: { to: string; reason?: string }
  escrow?: { reference: string; seller: string; amountSol: number; deadlineSecs: number }
  deposit?: { sig: string; buyer: string }
  delivered?: { raw: string; data?: unknown }
  release?: { sig: string }
  refunded?: boolean
  status: 'bidding' | 'awarded' | 'deposited' | 'delivered' | 'settled' | 'refunded'
}
export function foldRounds(messages: { sender: string; text: string }[]): Round[]
```

`foldRounds` is where the testing leverage is: feed it a fixture array of raw messages, assert the
`Round[]`. No network, fully deterministic.

### One small protocol tweak (recommended)

The LLM's *reasoning* for the award currently goes to the buyer's stderr, not the thread — so the UI
can't show it. Make the buyer include it: `AWARD round=1 to=seller-premium reason="verified data worth +0.0003"`.
A 1-line change in `buyer-agent` + `parseAward`, and the reasoning becomes visible in the transcript
(also better for the "no black box" goal). Without it, the card just omits the reason.

---

## Stack (idiomatic + forkable)

| Concern | Choice | Why |
|---------|--------|-----|
| Build/app | **Vite + React + TypeScript** | the kit's existing choice; fast, zero-config forking |
| Server data | **TanStack Query** (polling, 1s) | the idiomatic way to poll + cache; trivial to swap for SSE later |
| Styling | **Tailwind** (or CSS modules) | forkable, no design system to learn |
| Unit tests | **Vitest + Testing Library** | matches the repo's vitest; component + reducer tests |
| E2E tests | **Playwright** | drives the real app against a mocked feed — deterministic, CI-friendly |
| Feed server | **Express** (+ `node-fetch`/built-in fetch) | ~60 lines, same stack as the agents |

No wallet-adapter, no `@solana/web3.js` in the app — the core is read-only. (Wallet integration is a
documented fork-point extension, below.)

---

## Components

```
web/src/
  App.tsx                 # SessionPicker + MarketView + ConnectionStatus
  api.ts                  # typed fetch to the feed server (useFeed hook via TanStack Query)
  foldRounds.ts           # pure reducer (shared with the feed server)
  components/
    MarketView.tsx        # the live feed — maps Round[] → <RoundCard>
    RoundCard.tsx         # one round: WANT header, bids, award, settlement, status pill
    BidRow.tsx            # seller · price · note · win/lose/declined styling
    SettlementBadge.tsx   # DEPOSITED/RELEASED → explorer.solana.com/tx/{sig}?cluster=devnet
    ProviderBadge.tsx     # which LLM the market is running on (anthropic | openai)
    StatusPill.tsx        # bidding → awarded → settled
```

---

## The feed server (endpoints)

```
GET  /api/sessions                    → [{ sessionId, createdAt }]      (active sessions)
GET  /api/feed?session=<sid>          → { rounds: Round[], updatedAt }  (folded transcript)
POST /api/round                       → launch a WANT (optional operator trigger)
```

`/api/feed` calls coral's `/api/v1/local/session/{ns}/{sid}/extended` with the `CORAL_TOKEN`,
collects the thread messages, runs `foldRounds`, and returns typed rounds. The React app polls it.

---

## Testing strategy (the "e2e-tested" requirement)

Three layers, all runnable in CI **without devnet or an LLM key**:

1. **Unit — the reducer** (`foldRounds.test.ts`): feed fixtures of raw messages (full round, a
   declined seller, a refund-after-deadline, an interleaved two-round transcript) → assert `Round[]`.
   This is the highest-value test; the protocol folding is the brains.
2. **Component** (`RoundCard.test.tsx`, Vitest + Testing Library): given a `Round` fixture, assert the
   winner is highlighted, the declined seller shows, and the Explorer link `href` is correct.
3. **E2E** (`market.spec.ts`, Playwright): start the Vite app with the feed **mocked** (Playwright
   route interception or MSW serving a fixture), then assert the rendered auction — WANT text, two bid
   rows, the awarded winner, a `RELEASED` badge whose link points at `explorer.solana.com/...devnet`.
   Deterministic, fast, no infra.
   - *Optional* `@live` Playwright project (gated by `LIVE=1`) that runs the real `just market` and
     asserts a round appears — the smoke test for a real environment.

Scripts: `npm test` (vitest), `npm run e2e` (playwright), `npm run e2e:live` (the gated live smoke).

---

## Fork points (what students change)

| Want… | Edit |
|-------|------|
| render a new bid field (eta, reputation) | `BidRow.tsx` + add the field to `parseBid`/`foldRounds` |
| a different layout / theme | `RoundCard.tsx` + Tailwind classes |
| trigger a WANT from the UI | wire a button to `POST /api/round` (operator mode) |
| live updates without polling | swap TanStack Query polling for an SSE endpoint on the feed server |
| **let a human fund/settle** (advanced) | add wallet-standard via framework-kit (`@solana/react-hooks`) + a browser escrow client — see the `solana-dev` skill |

---

## Phases & effort

| Phase | Work | ~hrs |
|-------|------|------|
| 1 | `foldRounds.ts` + `foldRounds.test.ts` (pure, reuses runtime parsers) | 2 |
| 2 | Feed server (`/api/sessions`, `/api/feed`) + a fixture for tests | 2 |
| 3 | React app: `useFeed` + `MarketView` + `RoundCard`/`BidRow`/`SettlementBadge` | 4 |
| 4 | Component tests (Vitest + RTL) | 1.5 |
| 5 | Playwright e2e against the mocked feed (+ gated `@live`) | 2.5 |
| 6 | The `AWARD reason` protocol tweak + render it; README + screenshots | 1.5 |
| 7 | Wire into `just`: `just dashboard` (feed + vite); CI workflow runs unit + e2e | 1 |

**~14.5h.** The reducer + fixtures (Phases 1–2) are what make the whole thing testable without devnet —
do them first.

## Out of scope (extensions, not v1)

- Wallet connection / a human funding the escrow (framework-kit + wallet-standard) — a documented fork.
- Persistence / history across sessions (the feed is live-only).
- Auth on the feed server (fine for local/devnet; harden before any public deploy).

---

## Verification checklist

```sh
cd examples/marketplace/web
npm install
npm test          # foldRounds + component tests — green, no infra
npm run e2e       # Playwright vs the mocked feed — the auction renders, links point to devnet explorer
# live (optional): in one shell `just market`; in another:
LIVE=1 npm run e2e:live    # asserts a real round shows up in the dashboard
```

When the mocked e2e is green, the frontend is **proven without devnet**; the `@live` run is what ties
it to a real market. Students fork `RoundCard.tsx` and the fixtures and they're productive in minutes.
