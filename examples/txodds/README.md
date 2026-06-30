# Example: Freelance Escrow Agent

> Employer-funded freelance work with a neutral review agent and Solana devnet escrow settlement.

This example uses the existing deployed escrow and arbiter programs. Demo jobs are kept in memory while
the API runs and saved to `examples/txodds/.data/jobs.json` after each mutation.

## Structure

```text
examples/txodds/
  agent/
    review.ts      task + chat + submission -> review JSON
    arbiter.ts     client for the deployed arbiter wrapper
    escrow.ts      client for the base escrow program
  server/
    proxy.ts       HTTP API for jobs, chat, funding retry, review, release, refund
    state.ts       pure job reference and lifecycle helpers
    persistence.ts local JSON state store
  web/             no-build React dashboard
  escrow/          Anchor escrow and arbiter programs
```

## Run

From the repo root:

```sh
npm install --prefix scripts
node scripts/setup.js
npm run dev
```

Or by hand from this directory:

```sh
npm install
npm run proxy
npm run web
```

The API listens on `http://localhost:8801`. The UI listens on `http://localhost:3020`.
`npm run dev` waits for `GET /api/health` and the web root before opening the browser.

## Required Wallets

`node scripts/setup.js` writes these to the repo-root `.env`:

| Key | Role |
|-----|------|
| `BUYER_KEYPAIR_B58` | Employer wallet; funds escrow and tops up arbiter fees |
| `SELLER_KEYPAIR_B58` / `WALLET` | Worker payout wallet |
| `ARBITER_KEYPAIR_B58` | Neutral signer for release/refund |
| `SOLANA_RPC_URL` | Devnet RPC, default `https://api.devnet.solana.com` |

Fund the employer wallet at `https://faucet.solana.com`.

## Review Agent

`reviewDelivery()` returns:

```json
{
  "approved": true,
  "score": 87,
  "confidence": 0.74,
  "summary": "...",
  "missing": [],
  "releaseReason": "...",
  "criteria": [{ "text": "Mobile layout works", "score": 90, "verdict": "pass" }]
}
```

If an LLM key is present, the review goes through `complete()`. Without a key, the deterministic
fallback derives criteria from the requirements and acceptance criteria, then scores whether submission
evidence and chat cover those terms. The fallback is labelled as manual/demo review because it does not
clone repos, run builds, or inspect live URLs.

## API

| Route | Purpose |
|-------|---------|
| `GET /api/health` | API readiness and wallet configuration |
| `GET /api/state` | Full dashboard state |
| `POST /api/quote` | Funding quote with budget, escrow rent, arbiter top-up, and estimated debit |
| `POST /api/jobs` | Create and fund a job |
| `POST /api/jobs/:id/fund` | Retry escrow funding after adding devnet SOL |
| `POST /api/jobs/:id/messages` | Add employer/worker chat |
| `POST /api/jobs/:id/submission` | Add worker delivery evidence |
| `POST /api/jobs/:id/review` | Review and release if approved |
| `POST /api/jobs/:id/release` | Retry release after an approved review without rerunning review |
| `POST /api/jobs/:id/dispute` | Add dispute note and rerun review |
| `POST /api/jobs/:id/refund` | Refund after deadline on rejected/disputed work |

## Demo Checklist

1. Fund the employer wallet from `WALLETS.txt`.
2. Open the dashboard and create a job.
3. If the job shows `Funding failed`, use the faucet link and click `Retry funding`.
4. Add chat, submit worker evidence, then click `Review and settle`.
5. If review succeeds but release fails, click `Retry release`.

## SOL Cost Quote

The employer funds the budget and also pays escrow rent. The API may also transfer `0.02 SOL` from the
employer to the arbiter wallet when the arbiter is below `0.01 SOL`, so a tiny `0.001 SOL` job can debit
roughly `0.02 SOL` above the budget, plus current rent and network fees. The dashboard shows that
breakdown before funding and on the escrow panel after creation. On approved release, escrow rent
returns to the deployed arbiter wrapper's vault PDA, which is why the vault balance remains visible.

## Local State

`examples/txodds/.data/jobs.json` is gitignored demo state. Delete it to reset the dashboard.

## Arbiter Config Guard

The deployed devnet arbiter wrapper has a one-time on-chain config. If the `ARBITER_KEYPAIR_B58` public
key does not match that config, the API shows a setup warning and will not fund new jobs. That prevents
opening escrows that the current arbiter key cannot release or refund.

## Verify

```sh
npm run typecheck
npm test
```
