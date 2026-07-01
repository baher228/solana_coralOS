# Troubleshooting

## Ports are busy

```powershell
Get-NetTCPConnection -LocalPort 3020,8801 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

## No wallets

```sh
npm install --prefix scripts
node scripts/setup.js
```

This writes fresh local keys to `.env` and public addresses to `WALLETS.txt`.

## Reset jobs

Use the Operations tab or delete `examples/txodds/.data/`.
