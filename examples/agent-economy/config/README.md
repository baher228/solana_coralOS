# config — CoralOS server config

Holds **`coral.toml`**, the config for the stock `coral-server` (mounted at `/config/coral.toml` by
`docker-compose.yml`). coral-server runs here as a **pure MCP coordinator — no `[wallet]` section**,
because payments settle agent-side in SOL, so the server never holds a keypair.

What it sets:

| Section | Purpose |
|---|---|
| `[auth]` | dev API key (`dev`) the agents/bridge use |
| `[network]` | `allowAnyHost = true` for local dev |
| `[registry]` | scans `localAgents = ["/agents/*"]` — this is how coral discovers `buyer-agent`, `seller-agent`, and the personas `seller-cheap`/`-premium`/`-lazy` from the mounted `coral-agents/` folder |
| `[docker]` | how coral launches each agent as a container (`host.docker.internal`) |

**Registering a new agent:** drop a folder in `coral-agents/` with a `coral-agent.toml` (it must
include a `readme` field) — the registry scan picks it up. Note: on Windows Docker volumes the live
rescan is unreliable, so restart coral (`docker compose up -d --force-recreate coral`) to re-scan.
