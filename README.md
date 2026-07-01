# Freelance Escrow Agent

A no-build Solana CoralOS demo for freelance work: an employer opens a job, a worker submits evidence,
and a review agent releases, disputes, or refunds the local demo escrow.

This repo keeps the useful backbone from the referenced project: a root `npm run dev`, one Node proxy,
a static React UI, the shared `packages/agent-runtime`, and the optional direct escrow program under
`examples/txodds/escrow`. Secrets and generated state are not committed.

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
| `GET /api/state` | Jobs, setup state, local escrow references |
| `POST /api/jobs` | Create a funded local demo escrow job |
| `POST /api/jobs/:id/messages` | Add employer/worker/agent message |
| `POST /api/jobs/:id/submission` | Add worker delivery evidence |
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
