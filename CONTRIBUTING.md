# Contributing

Use Node 20+.

```sh
cd packages/agent-runtime
npm install
npm run typecheck
npm test

cd ../../examples/txodds
npm install
npm run typecheck
npm test
```

Keep `.env`, `WALLETS.txt`, `node_modules`, build output, and `examples/txodds/.data/` out of git.
