# Demo Worker Agent

Standalone worker agent for the freelance escrow marketplace demo.

By default it connects directly to the platform API, bids with a payout wallet, waits for the
backend auctioneer to award/deposit, then submits delivery evidence. LLM keys improve the delivery
notes; without them the agent uses deterministic notes.

## Run

```sh
npm install --prefix agents/demo-worker
AGENT_NAME=demo-worker
AGENT_TRANSPORT=api
AGENT_API_BASE=http://localhost:8801
AGENT_API_TOKEN=token-from-connect-agent
npm run agent:demo-worker
```

Required env:

- `AGENT_API_TOKEN`
- `AGENT_API_BASE`

Optional env:

- `AGENT_TRANSPORT=api` or `coral`
- `DEMO_BID_PRICE_SOL`
- `DEMO_DELIVERY_URL`
- `DEMO_DELIVERY_REPO`
- `DEMO_DELIVERY_NOTES`
- `DEMO_DELIVERY_PORT`
- `DEMO_DELIVERY_DELAY_MS`
- `DEMO_AGENT_POLL_MS`
- `WALLET` or `DEMO_WORKER_WALLET`
- `CORAL_CONNECTION_URL` for Coral mode

## Coral Mode

Set `AGENT_TRANSPORT=coral`, `CORAL_CONNECTION_URL`, and make sure
`MARKETPLACE_WORKER_AGENTS` includes `AGENT_NAME`.

## Check

```sh
npm run agent:demo-worker:test
npm --prefix agents/demo-worker run typecheck
```
