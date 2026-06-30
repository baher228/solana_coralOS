# scripts

Helper scripts for the freelance escrow demo.

## `setup.js`

```sh
npm install --prefix scripts
node scripts/setup.js
```

Generates employer, worker, and arbiter devnet keys, writes them into the repo-root `.env`, and saves
their public addresses to `WALLETS.txt`. Re-running preserves existing keys and any LLM keys you added.

Fund the employer wallet at `https://faucet.solana.com`.

## `txodds.js`

```sh
npm run dev
```

Starts the escrow API on `http://localhost:8801`, the dashboard on `http://localhost:3020`, and opens
the browser after both are ready. It fails fast if either port is occupied or a child process exits.
Jobs are saved under `examples/txodds/.data/`. The filename is kept for compatibility with the existing
`npm run dev` entry point.
