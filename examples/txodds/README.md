# Freelance Escrow Platform Example

This example uses the original backbone layout: `server/proxy.ts` serves the API, `web/` is a no-build
React app, and `npm run dev` from the repo root starts both.

```sh
npm install
npm run typecheck
npm test
npm run proxy
npm run web
```

The platform is local by default. It models jobs, milestones, messages, submissions, disputes, and
escrow state without checking in secrets or preserving prior deployment config. The old dashboard is
kept separately at `web/legacy.html`.
