# Freelance Escrow Platform

A Vite React Solana CoralOS freelance escrow platform v1: an employer funds a job, a worker tracks
milestones and submits evidence, and review settles, disputes, or refunds the local demo escrow.

This repo keeps the useful backbone from the referenced project: a root `npm run dev`, one Node proxy,
a Vite React platform UI, the shared `packages/agent-runtime`, and the optional direct escrow program
under `examples/txodds/escrow`. The previous standalone no-build dashboard remains available as
`legacy.html`.

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

For the fully guided interactive demo with the Coral bus, marketplace bridge, and three review
panel agents running together:

```sh
npm run dev:demo
```

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

CoralOS-style agent coordination uses a separate MCP bus from the platform worker MCP endpoint.
`http://localhost:8801/mcp` is for connected worker tools. `http://localhost:8001/mcp` is the
local Coral-compatible thread/message bus used by the marketplace bridge and the three review
panel agents. Start that bus first:

```sh
npm run coral:bus
```

Then set a platform admin token, the Coral bus URL, the worker names, and the three review panel
agents. Run the bridge, worker, and panel agents in separate terminals:

```sh
AGENT_API_TOKEN=choose-a-local-token
CORAL_BUS_PORT=8001
CORAL_CONNECTION_URL=http://localhost:8001/mcp
MARKETPLACE_WORKER_AGENTS=demo-worker
MARKETPLACE_REVIEW_AGENTS=worker-advocate,employer-advocate,referee
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

```sh
cd examples/txodds
CORAL_CONNECTION_URL=http://localhost:8001/mcp AGENT_NAME=worker-advocate REVIEW_PANEL_ROLE=worker npm run agent:review-panel
CORAL_CONNECTION_URL=http://localhost:8001/mcp AGENT_NAME=employer-advocate REVIEW_PANEL_ROLE=employer npm run agent:review-panel
CORAL_CONNECTION_URL=http://localhost:8001/mcp AGENT_NAME=referee REVIEW_PANEL_ROLE=referee npm run agent:review-panel
```

After delivery, the bridge collects repository/build/test/preview/screenshot artifacts and sends them
through the Coral panel. LLM keys improve delivery notes and panel arguments, but the worker and panel
still emit deterministic fallback notes/verdicts when no LLM key is configured.

## MCP Worker Agents

Connected agent tokens also work as MCP API keys. After creating an agent in Settings, configure
any Streamable HTTP MCP client with:

```txt
URL: http://localhost:8801/mcp
Authorization: Bearer <generated-agent-token>
```

The MCP server exposes worker tools to list jobs, inspect a job, bid, submit delivery evidence, and
check agent status. It does not expose employer/admin actions to worker tokens. Older clients that
only support stdio MCP need a small stdio-to-HTTP adapter; v1 exposes HTTP directly.

Open the **AI Agents** tab in the web app, or read `examples/txodds/web/agent-guide.md`, for the
full setup guide and REST/MCP request cookbook.

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
| `POST /mcp` | Streamable HTTP MCP endpoint for connected worker agents |
| `GET /api/agent/jobs` | Protected list of open/current jobs for worker agents or the bridge |
| `POST /api/agent/jobs/:id/bids` | Protected worker-agent bid |
| `POST /api/agent/jobs/:id/award` | Platform-token-only award + devnet escrow deposit |
| `POST /api/agent/jobs/:id/delivery` | Protected worker-agent delivery evidence |
| `POST /api/agent/jobs/:id/artifacts` | Platform-token-only build/test/screenshot collection for Coral panel review |
| `POST /api/agent/jobs/:id/panel-review` | Platform-token-only Coral panel verdict |
| `POST /api/agent/jobs/:id/settle` | Platform-token-only conditional devnet release/refund |

## Verify

```sh
cd examples/txodds
npm install
npm run typecheck
npm test
```

Local jobs are saved in `examples/txodds/.data/`, which is gitignored.
