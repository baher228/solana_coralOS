# Freelance Escrow Agent Example

This example uses the original backbone layout: `server/proxy.ts` serves the API, `web/` is a no-build
React app, and `npm run dev` from the repo root starts both.

```sh
npm install
npm run typecheck
npm test
npm run proxy
npm run web
```

The demo is local by default. It models escrow state and review decisions without checking in secrets
or preserving prior deployment config. Run `node ../../scripts/setup.js` to generate fresh employer/worker
devnet wallets when you need local keys.
