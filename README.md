# Freelance Escrow Agent

> A devnet Solana demo where an employer funds a freelance task, a worker submits delivery evidence,
> and a neutral escrow agent reviews the task, chat, and submission before releasing or disputing funds.

The demo keeps the deployed escrow and arbiter programs, but the product surface is now freelance work
instead of sports data. `npm run dev` starts one local API process plus one static web UI.

## What It Shows

| Part | Role |
|------|------|
| Employer | Writes a task, requirements, acceptance criteria, budget, and deadline |
| Worker | Chats with the employer and submits a URL, repo, and build notes |
| Escrow agent | Reviews the original task, acceptance criteria, chat transcript, and submission |
| Solana escrow | Employer funds an arbiter-controlled vault; the arbiter releases or refunds on devnet |

The review agent uses `complete()` from `packages/agent-runtime` when an LLM key is configured. Without
one, it falls back to a deterministic demo review that is explicitly labelled as manual/demo review.

## Quick Start

```sh
npm install --prefix scripts
node scripts/setup.js
npm run dev
```

Fund the generated employer wallet with devnet SOL:

```text
https://faucet.solana.com
```

Optional LLM keys in `.env`:

```ini
ANTHROPIC_API_KEY=...
# or
LLM_PROVIDER=openai
OPENAI_API_KEY=...
# or
LLM_PROVIDER=venice
VENICE_API_KEY=...
```

## Local Processes

`npm run dev` runs [`scripts/txodds.js`](scripts/txodds.js), which starts:

| Process | URL | Purpose |
|---------|-----|---------|
| API | `http://localhost:8801` | Jobs, chat, submissions, review, local JSON persistence, arbiter escrow settlement |
| Web | `http://localhost:3020` | No-build React dashboard for employer, worker, and escrow agent views |

The runner checks ports `8801` and `3020`, waits for `/api/health` and the web root, then opens the
browser. If a process exits or a port is occupied, it fails with the command that needs attention.

## API

| Route | Purpose |
|-------|---------|
| `GET /api/health` | Readiness, devnet RPC, and wallet configuration without balance reads |
| `GET /api/state` | Jobs, selected job, wallets, balances, network, settlement links |
| `POST /api/quote` | Estimate budget, escrow rent, arbiter top-up, and total employer debit |
| `POST /api/jobs` | Create a job and open arbiter escrow |
| `POST /api/jobs/:id/fund` | Retry funding a job after adding devnet SOL |
| `POST /api/jobs/:id/messages` | Append employer/worker chat |
| `POST /api/jobs/:id/submission` | Record worker evidence |
| `POST /api/jobs/:id/review` | Run the escrow agent review and release if approved |
| `POST /api/jobs/:id/release` | Retry only the on-chain release after an approved review |
| `POST /api/jobs/:id/dispute` | Record a dispute note and rerun review |
| `POST /api/jobs/:id/refund` | Refund through the arbiter after the deadline on rejected/disputed work |

## Demo Checklist

1. Run `node scripts/setup.js`.
2. Fund the employer wallet shown in `WALLETS.txt`.
3. Start `npm run dev` and confirm the dashboard opens.
4. If funding fails, use the faucet link in the UI, then click `Retry funding`.
5. Submit delivery evidence, review, and confirm the release Explorer link appears.

## Cost Quote

The budget is not the only debit from the employer wallet. `POST /api/quote` and the dashboard show:

- job budget
- escrow account rent
- arbiter fee-wallet top-up when the arbiter is below `0.01 SOL`
- total estimated debit, excluding small variable network fees

For example, a tiny `0.001 SOL` job can still debit roughly `0.02 SOL` above the budget when the
arbiter needs the automatic top-up, plus the current escrow rent and network fees.
On approved release, the deployed arbiter wrapper returns escrow rent to its vault PDA; the dashboard
shows that vault balance explicitly.

## Local State

Jobs are restored from `examples/txodds/.data/jobs.json` on API startup and saved after each mutation.
That file is gitignored and is still demo storage, not a production database.

## Arbiter Config

The deployed devnet arbiter program has a one-time on-chain config that names the arbiter public key.
If `ARBITER_KEYPAIR_B58` does not match that configured public key, the API reports a setup warning and
refuses to fund new jobs, because the current signer would not be able to release or refund them.

## Settlement Programs

The deployed devnet programs live under [`examples/txodds/escrow`](examples/txodds/escrow):

| Program | Instruction | Role |
|---------|-------------|------|
| Escrow `R5NWNg9...CeXet` | `initialize`, `release`, `refund` | Base SOL escrow |
| Arbiter `FJtuVXsy...ktXd` | `open`, `arbitrate_release`, `arbitrate_refund` | Neutral releaser/refunder |

The demo is devnet-only. The runtime's Solana connection guard rejects mainnet RPCs unless explicitly
overridden with `ALLOW_MAINNET=1`.

## Repo Layout

| Directory | Purpose |
|-----------|---------|
| `examples/txodds/agent/review.ts` | Freelance delivery review agent |
| `examples/txodds/server/` | API, local JSON persistence, and pure job state helpers |
| `examples/txodds/web/` | Static React dashboard |
| `examples/txodds/escrow/` | Anchor escrow and arbiter programs |
| `packages/agent-runtime/` | LLM, Solana, Coral, and market runtime helpers |
| `scripts/` | Wallet setup and one-command demo runner |

## Verify

```sh
cd examples/txodds
npm run typecheck
npm test
```

## License

MIT
