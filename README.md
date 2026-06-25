# solana_coralOS — Agent Economy Starter

> A seller **agent** lists a service; buyers — **agent or human** — request it over **CoralOS**, pay
> in **SOL** on-chain, and the seller verifies the payment and delivers. One protocol, one seller,
> **two front doors.**

Every payment is a real on-chain **devnet** transaction. CoralOS (coral-server) coordinates the
agents as a pure MCP message bus — it runs **stock and wallet-free**, because payments settle
agent-side in SOL.

- **Autonomous** front door — an LLM buyer agent requests, decides, and pays another agent.
- **Checkout** front door — a human connects Phantom and pays the same seller, one click.

Both run through the same seller agent over CoralOS. Proven live on devnet (gates G1–G3, see
[`.claude/AGENT_ECONOMY_RESTRUCTURE.md`](.claude/AGENT_ECONOMY_RESTRUCTURE.md)).

---

## 🔑 Keys & accounts you need

Everything is **devnet** and **free**. You bring your own keys in a local `.env` — none are in the
repo. `scripts/setup.js` generates the Solana wallets for you, so you mostly just fund them.

### Required

| What | For | How to get it |
|------|-----|---------------|
| **Devnet SOL** (2 wallets) | paying + receiving | `node scripts/setup.js` generates a buyer + seller keypair into `.env` and prints two addresses. **Fund both** at [faucet.solana.com](https://faucet.solana.com) (free). |
| **Anthropic API key** | the LLM buyer *decides* to pay (+ the seller's optional `inference` service) | Free-tier key at [console.anthropic.com](https://console.anthropic.com) → `ANTHROPIC_API_KEY`. *(The on-chain payment works without it — this is only the agent's reasoning step.)* |
| **Phantom wallet** | the human Checkout door | [phantom.com](https://phantom.com) extension, set to **Devnet**. |
| **Docker Desktop** | coral-server launches the agents | [docker.com](https://www.docker.com/products/docker-desktop/). *(Skip it with the no-Docker quickstart below.)* |

### Optional (free fallbacks)

| Key | For | Get it |
|-----|-----|--------|
| `HELIUS_API_KEY` | faster devnet RPC | [helius.dev](https://helius.dev) — falls back to public devnet |
| `JUPITER_API_KEY` | higher rate limits | [jup.ag/developers](https://jup.ag/developers) |
| `NEWS_API_KEY` | only `SERVICE=news` | [newsapi.org](https://newsapi.org) |

> Have an OpenAI/Codex key but not Anthropic? The LLM step is Anthropic-only today — swap the call
> in `coral-agents/buyer-agent/src/llm_buyer.ts` or open an issue.

---

## Quick start

```sh
git clone https://github.com/trilltino/solana_coralOS
cd solana_coralOS

cd scripts && npm install && cd ..
node scripts/setup.js                  # generates wallets → .env, prints 2 addresses to fund
# fund both at https://faucet.solana.com, then add ANTHROPIC_API_KEY=sk-ant-… to .env

# build the agent images coral-server launches
bash build-agents.sh seller && bash build-agents.sh buyer
docker build -t user-proxy:0.1.0 coral-agents/user_proxy

docker compose up -d coral             # stock coral-server (wallet-free MCP bus)
```

Then pick a front door — full guide in [`examples/agent-economy/`](examples/agent-economy/README.md):

```sh
# Autonomous (agent → agent)
cd examples/agent-economy/autonomous && npm install && npm start
docker logs -f buyer-agent             # watch it pay + receive

# Checkout (human → agent)
docker compose up -d bridge            # then open http://localhost:3010 with Phantom (Devnet)
```

**No Docker?** [`examples/agent-economy/quickstart/`](examples/agent-economy/quickstart/README.md)
is the same pay-per-call loop as two bare-metal Node processes over plain HTTP `402`.

---

## Repo layout

| Directory | Purpose |
|-----------|---------|
| `examples/agent-economy/` | **the track** — autonomous starter, human bridge, config, no-Docker quickstart |
| `coral-agents/` | the agents coral-server launches: `seller-agent` (fork `service.ts`), `buyer-agent`, `user-proxy`, `echo-agent` |
| `packages/agent-runtime/` | agent runtime: `AgentManager`, `Strategy`, MessageBus, CoralOS MCP client, strategies |
| `api-server/` | Express REST API (:8081) wrapping the runtime |
| `web/` | Next.js marketplace UI |
| `scripts/` | `setup.js` (wallet generation) + smoke tests |
| `docker-compose.yml` | coral + bridge + web |

## How the payment cycle works

```
buyer (agent or human) → "request <query>"           → seller
seller → "PAYMENT_REQUIRED memo=… amount=… url=solana:…"
buyer  → pays the URL on devnet (keypair, or Phantom) → sig
buyer  → "paid <sig> memo=…"                          → seller
seller → getTransaction(sig): verifies recipient + amount on-chain
seller → "DELIVERED <data>"
```

All verification is on-chain. No off-chain trust.

> **CoralOS note:** coral-server is used here purely as the MCP coordination layer. Its *native*
> payment rail (x402/CORAL token) is **not** used — it's half-built upstream — so the kit settles in
> plain SOL, which works end-to-end. Details in `.claude/AGENT_ECONOMY_RESTRUCTURE.md`.

## License

MIT
