# Kirill's contributions

An upgraded, drop-in frontend for the Freelance Escrow Platform. It talks to the
**same** API proxy (`examples/txodds/server/proxy.ts`) and changes nothing else in
the repo - it lives entirely in this folder.

## Contents

- `index.html`, `app.js`, `app.css`, `accounts.json` - a self-contained, no-build
  React app (React + htm loaded from esm.sh, no bundler), same as the original
  `examples/txodds/web` approach.

## Preview

From the repo root, start the existing API proxy, then serve this folder:

```sh
cd examples/txodds && npm install && npm run proxy      # API on http://localhost:8801
npx --yes serve "Kirill's contributions" -l 3020        # UI  on http://localhost:3020
```

Open http://localhost:3020. The UI points at the proxy on `:8801` by default
(override with `window.FREELANCE_API`). Seed a demo job from Settings, or via
`curl -X POST http://localhost:8801/api/demo/seed`.

## What's new vs. the original UI

Keeps every capability of the original (login/accounts, post & claim tasks,
marketplace, messages, milestone delivery + evidence, AI review, payments,
disputes/refunds, import/export) and adds:

- Redesigned visual system on the same palette - soft shadows, motion, a dark-mode
  toggle, and toast notifications for every action.
- A **job lifecycle stepper** (Posted -> Funded -> Delivered -> Reviewed -> Released)
  on every task.
- The AI review rendered as a **score ring** with per-criterion pass/fail checks,
  missing-evidence and risk tags.
- A **Reputation / trust** view derived from on-platform activity (completed jobs,
  disputes, SOL earned/spent), plus a counterparty trust bar in each task.
- Working **global search** (`/` to focus), an **activity timeline**, copy-to-clipboard
  on references/escrow addresses, and milestone progress bars.
- An **account dropdown** (refresh / appearance / sign out).
- Surfaces the deterministic **heuristic settle** path while keeping main's
  existing AI review and release gates intact.
