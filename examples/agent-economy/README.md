# examples/agent-economy

Supporting pieces for the marketplace (the runnable example lives in
[`../marketplace/`](../marketplace/README.md)):

- **`config/coral.toml`** — the wallet-free CoralOS config. coral-server runs as a pure MCP
  coordinator and discovers the agents from `coral-agents/`; it never holds a keypair.
- **`escrow/`** — the Anchor escrow contract (the settlement spine), already deployed to devnet. The
  buyer deposits into a per-order PDA seeded by `(buyer, reference)`, the seller delivers, the buyer
  releases (or refunds after a deadline). See its [`README.md`](escrow/README.md).

To run the market: build the agent images (`bash build-agents.sh`), start coral
(`docker compose up -d coral`), then `cd examples/marketplace && npm start`. Full walkthrough in the
[root README](../../README.md) and [`docs/MARKETPLACE.md`](../../docs/MARKETPLACE.md).

Devnet only. Never put a funded mainnet keypair in `.env`.
