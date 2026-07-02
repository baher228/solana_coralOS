# scripts

## `setup.js`

```sh
npm install --prefix scripts
node scripts/setup.js
```

Generates fresh employer and worker devnet keys in `.env` and writes public addresses to `WALLETS.txt`.
Both files are gitignored. No third-party settlement key is generated.

## `txodds.js`

```sh
npm run dev
```

Starts the freelance escrow API on `http://localhost:8801` and the static platform UI on
`http://localhost:3020`. The filename is kept for compatibility with the imported backbone.
