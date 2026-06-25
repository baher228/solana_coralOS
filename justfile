# Agent Economy — dev tasks.  Run `just dev` for one-shot setup → build → run.
#
# Needs: Docker Desktop running, Node 20+, and `just` (https://github.com/casey/just):
#   cargo install just  |  brew install just  |  winget install Casey.Just
# Runs from PowerShell (Windows) or any POSIX shell. No `just`? Every recipe below is plain
# node/npm/docker commands — run them by hand.

# On Windows, use PowerShell so node/npm/docker (on the Windows PATH) are found.
set windows-shell := ["powershell.exe", "-NoProfile", "-Command"]

# default: list the recipes
default:
    @just --list

# ── one-shot: wallets + build images + start coral & bridge ──────────────────
dev: setup build up
    @echo ""
    @echo "Agent economy is up (coral + bridge)."
    @echo "FUND the two printed wallets at https://faucet.solana.com (sign in with GitHub) before the agents can pay."
    @echo "Then open http://localhost:3010 and click Run in the Autonomous tab (give the agents ~20s on first run)."
    @echo "Logs: just logs    Stop: just down"

# generate the devnet wallets (fund them manually at the faucet)
setup:
    npm install --prefix scripts --silent --no-audit --no-fund
    node scripts/setup.js

# build the agent images coral-server launches (shell-agnostic — no bash needed)
build:
    docker build -f coral-agents/seller-agent/Dockerfile -t seller-agent:0.1.0 .
    docker build -f coral-agents/buyer-agent/Dockerfile -t buyer-agent:0.1.0 .
    docker build -f coral-agents/user_proxy/Dockerfile -t user-proxy:0.1.0 coral-agents/user_proxy

# start coral-server + the bridge (serves the demo UI on :3010)
up:
    docker compose up -d coral bridge

# run the autonomous loop from the CLI (alternative to the UI button)
auto:
    npm install --prefix examples/agent-economy/autonomous --silent --no-audit --no-fund
    npm --prefix examples/agent-economy/autonomous start

# tail coral-server logs
logs:
    docker compose logs -f coral

# stop everything
down:
    docker compose down
