#!/usr/bin/env bash
# Build the agent images coral-server launches (from repo root so they can bundle packages/).
# Run this once before `docker compose up`. The seller personas (cheap/premium/lazy) reuse the
# seller-agent image — no separate build needed.
#
# Usage: bash build-agents.sh            (build all)
#        bash build-agents.sh seller     (seller-agent only)
#        bash build-agents.sh buyer      (buyer-agent only)

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

build_seller() {
  echo "==> Building seller-agent:0.1.0"
  docker build -f "$ROOT/coral-agents/seller-agent/Dockerfile" -t seller-agent:0.1.0 "$ROOT"
  echo "    seller-agent:0.1.0 done (also runs as seller-cheap / seller-premium / seller-lazy)"
}

build_buyer() {
  echo "==> Building buyer-agent:0.1.0"
  docker build -f "$ROOT/coral-agents/buyer-agent/Dockerfile" -t buyer-agent:0.1.0 "$ROOT"
  echo "    buyer-agent:0.1.0 done"
}

case "${1:-all}" in
  seller) build_seller ;;
  buyer)  build_buyer ;;
  all)
    build_seller
    build_buyer
    echo ""
    echo "All agent images built. Start the marketplace:"
    echo "  docker compose up -d coral"
    echo "  cd examples/marketplace && npm install && npm start"
    ;;
  *) echo "Usage: bash build-agents.sh [seller|buyer|all]"; exit 1 ;;
esac
