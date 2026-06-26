# Agent marketplace — dev tasks.  `just dev` = wallets + build + coral up, then `just market`.
#
# Needs: Docker Desktop running, Node 20+, and `just` (https://github.com/casey/just):
#   cargo install just  |  brew install just  |  winget install Casey.Just
# No `just`? Every recipe below is a plain node/npm/docker one-liner.

# On Windows, use cmd (full system PATH; supports && and cd like sh).
set windows-shell := ["cmd.exe", "/c"]

# default: list the recipes
default:
    @just --list

# ── one-shot: wallets + build images + coral + open the dashboard ───────────
dev: setup build clean up
    @echo Coral is up. FUND the 2 printed wallets at https://faucet.solana.com (GitHub sign-in).
    @echo Opening the dashboard - click "Start a market" once the wallets are funded.
    node scripts/dashboard.js

# generate the devnet wallets (fund them manually at the faucet)
setup:
    cd scripts && npm install --no-audit --no-fund
    node scripts/setup.js

# build the agent images (personas reuse the seller image)
build:
    docker build -f coral-agents/seller-agent/Dockerfile -t seller-agent:0.1.0 .
    docker build -f coral-agents/buyer-agent/Dockerfile -t buyer-agent:0.1.0 .

# start coral-server (MCP coordinator)
up:
    docker compose up -d coral

# launch the marketplace session (buyer + 3 persona sellers)
market:
    cd examples/marketplace && npm install --no-audit --no-fund && npm start

# the visualizer: feed server + UI on :5173, opens the browser (click "Start a market" after funding)
dashboard:
    node scripts/dashboard.js

# just the feed server (logs-flow alternative; reads coral's transcript)
feed:
    cd examples/marketplace/feed && npm install --no-audit --no-fund && npm start

# readiness check: Docker, Node, wallets funded, coral up
doctor:
    cd scripts && npm install --no-audit --no-fund
    node scripts/doctor.js

# remove orphaned coral-spawned agent containers (also runs at the start of `just dev`)
clean:
    node scripts/clean.js

# tail coral-server logs
logs:
    docker compose logs -f coral

# stop everything
down:
    docker compose down
