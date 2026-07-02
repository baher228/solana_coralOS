# Freelance Escrow Platform

A no-build Solana CoralOS freelance escrow platform v1: an employer funds a job, a worker tracks
milestones and submits evidence, and review settles, disputes, or refunds the local demo escrow.

This repo keeps the useful backbone from the referenced project: a root `npm run dev`, one Node proxy,
a static React platform UI, the shared `packages/agent-runtime`, and the optional direct escrow program
under `examples/txodds/escrow`. The previous dashboard remains available as `legacy.html`.

## Run

```sh
npm install --prefix scripts
node scripts/setup.js
npm run dev
```

Open `http://localhost:3020`. The API listens on `http://localhost:8801`.

`node scripts/setup.js` creates fresh local devnet keys in `.env`:

- `BUYER_KEYPAIR_B58` - employer wallet
- `SELLER_KEYPAIR_B58` - worker wallet
- `WALLET` - worker public key

No third-party settlement key is generated or preserved.

## API

| Route | Purpose |
|---|---|
| `GET /api/health` | API status and wallet setup summary |
| `GET /api/platform` | Platform dashboard state |
| `GET /api/state` | Jobs, setup state, summary, and local escrow references |
| `POST /api/jobs` | Create a funded platform escrow job |
| `POST /api/jobs/:id/messages` | Add employer/worker/agent message |
| `POST /api/jobs/:id/submission` | Add worker delivery evidence |
| `POST /api/jobs/:id/milestones/:milestoneId/complete` | Mark a milestone complete |
| `POST /api/jobs/:id/review` | Deterministic review and release/revision decision |
| `POST /api/jobs/:id/dispute` | Mark job disputed |
| `POST /api/jobs/:id/refund` | Mark local demo escrow refunded |
| `POST /api/demo/seed` | Replace state with one demo job |
| `POST /api/state/reset` | Clear local jobs |

## Verify

```sh
cd examples/txodds
npm install
npm run typecheck
npm test
```

Local jobs are saved in `examples/txodds/.data/`, which is gitignored.
