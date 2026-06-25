#!/usr/bin/env bash
# Build the agent images coral-server launches (from repo root so they can bundle packages/).
# Run this once before `docker compose up`.
#
# Usage: bash build-agents.sh            (build all)
#        bash build-agents.sh seller     (seller-agent only)
#        bash build-agents.sh buyer      (buyer-agent only)
#        bash build-agents.sh proxy      (user-proxy only)

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

build_seller() {
  echo "==> Building seller-agent:0.1.0"
  docker build -f "$ROOT/coral-agents/seller-agent/Dockerfile" -t seller-agent:0.1.0 "$ROOT"
  echo "    seller-agent:0.1.0 done"
}

build_buyer() {
  echo "==> Building buyer-agent:0.1.0"
  docker build -f "$ROOT/coral-agents/buyer-agent/Dockerfile" -t buyer-agent:0.1.0 "$ROOT"
  echo "    buyer-agent:0.1.0 done"
}

build_proxy() {
  echo "==> Building user-proxy:0.1.0"
  docker build -f "$ROOT/coral-agents/user_proxy/Dockerfile" -t user-proxy:0.1.0 "$ROOT/coral-agents/user_proxy"
  echo "    user-proxy:0.1.0 done"
}

case "${1:-all}" in
  seller) build_seller ;;
  buyer)  build_buyer ;;
  proxy)  build_proxy ;;
  all)
    build_seller
    build_buyer
    build_proxy
    echo ""
    echo "All agent images built. Start the economy:"
    echo "  docker compose up -d coral bridge"
    echo "  cd examples/agent-economy/autonomous && npm start   # agent → agent"
    echo "  open http://localhost:3010                          # human → agent (Phantom)"
    ;;
  *) echo "Usage: bash build-agents.sh [seller|buyer|proxy|all]"; exit 1 ;;
esac
