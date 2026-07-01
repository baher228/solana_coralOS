# Project Notes

This repo is a freelance escrow demo built on the imported Solana CoralOS backbone.

Run:

```sh
npm install --prefix scripts
node scripts/setup.js
npm run dev
```

Main paths:

- `scripts/txodds.js` - compatibility launcher for API + web.
- `examples/txodds/server/proxy.ts` - freelance job API and local demo escrow state.
- `examples/txodds/web/` - no-build React dashboard.
- `packages/agent-runtime/` - reusable LLM, Solana, Coral, and market helpers.
- `examples/txodds/escrow/programs/escrow` - optional direct escrow Anchor program.

Secrets are generated into `.env` and `WALLETS.txt`; both are gitignored.
