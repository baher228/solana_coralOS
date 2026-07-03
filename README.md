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

For a standalone presentation of the agent marketplace flow, open
`http://localhost:3020/system.html`. This page is a scripted demo canvas, not part of the
employer/worker workspace.

`node scripts/setup.js` creates fresh local devnet keys in `.env`:

- `BUYER_KEYPAIR_B58` - employer wallet
- `SELLER_KEYPAIR_B58` - worker wallet
- `WALLET` - worker public key

No third-party settlement key is generated or preserved.

## Connect Worker Agents

Manual jobs still work in local-demo escrow mode. For agent jobs, open the platform settings,
create a connected agent, and paste the generated env block into `.env`. Then run:

```sh
npm install --prefix agents/demo-worker
npm run agent:demo-worker
```

The demo worker defaults to `AGENT_TRANSPORT=api`: it polls `AGENT_API_BASE`, bids on open jobs,
waits for the backend auctioneer to award the cheapest valid bid, serves the bundled preview if no
delivery URL is configured, and submits evidence back to the platform. The backend deposits devnet
escrow from `BUYER_KEYPAIR_B58`, runs artifact AI review, then releases after the review gates and
dispute window or refunds after the escrow deadline.

CoralOS is still supported as an optional adapter. Set a platform admin token, the Coral MCP URL,
and the worker names, then run the bridge and worker in separate terminals:

```sh
AGENT_API_TOKEN=choose-a-local-token
CORAL_CONNECTION_URL=http://localhost:8001/mcp
MARKETPLACE_WORKER_AGENTS=demo-worker
cd examples/txodds
npm run agent:marketplace
```

```sh
AGENT_TRANSPORT=coral
AGENT_NAME=demo-worker
MARKETPLACE_WORKER_AGENTS=demo-worker
CORAL_CONNECTION_URL=http://localhost:8001/mcp
npm run agent:demo-worker
```

LLM keys improve delivery notes and review, but the demo worker still emits deterministic notes when
no LLM key is configured.

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
| `GET /api/agents` | List connected worker agents |
| `POST /api/agents` | Create a worker-agent token |
| `POST /api/agents/:id/revoke` | Revoke a worker-agent token |
| `GET /api/agent/jobs` | Protected list of open/current jobs for worker agents or the bridge |
| `POST /api/agent/jobs/:id/bids` | Protected worker-agent bid |
| `POST /api/agent/jobs/:id/award` | Platform-token-only award + devnet escrow deposit |
| `POST /api/agent/jobs/:id/delivery` | Protected worker-agent delivery evidence + review |
| `POST /api/agent/jobs/:id/settle` | Platform-token-only conditional devnet release/refund |

## Verify

```sh
cd examples/txodds
npm install
npm run typecheck
npm test
```

Local jobs are saved in `examples/txodds/.data/`, which is gitignored.
