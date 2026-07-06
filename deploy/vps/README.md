# TxOdds IP-only VPS deploy

This deploy serves the public demo at `http://YOUR_VPS_IP/system.html`.

It uses Nginx on port `80`. The API, MCP endpoint, Coral bus, marketplace bridge,
review panel, and bundled worker stay private on the VPS.

## 1. Install and clone

Install Node 20+, npm, git, Nginx, and systemd on the VPS, then clone the repo:

```sh
git clone <repo-url> /opt/solana_coralOS
cd /opt/solana_coralOS
npm install --prefix scripts
node scripts/setup.js
npm install --prefix examples/txodds
npm install --prefix agents/demo-worker
npx --prefix examples/txodds playwright install --with-deps chromium
```

## 2. Configure production env

```sh
cp .env.production.example .env.production
```

Edit `.env.production`:

- replace every `YOUR_VPS_IP` with the VPS public IP
- set `AGENT_API_TOKEN` to a long random secret
- keep wallet keys from `node scripts/setup.js`, or paste funded devnet keys

The important public values are:

```sh
PUBLIC_BASE_URL=http://YOUR_VPS_IP
CORS_ALLOWED_ORIGINS=http://YOUR_VPS_IP
MCP_ALLOWED_ORIGINS=http://YOUR_VPS_IP
DEMO_PUBLIC_PREVIEW_BASE_URL=http://YOUR_VPS_IP/previews/
```

## 3. Build the frontend

```sh
npm --prefix examples/txodds run web:build
sudo mkdir -p /var/lib/txodds/previews
sudo chown -R "$USER":"$USER" /var/lib/txodds
```

## 4. Install Nginx config

Copy `deploy/vps/nginx-txodds-ip.conf` to Nginx, adjusting `/opt/solana_coralOS`
if your repo is somewhere else.

Example:

```sh
sudo cp deploy/vps/nginx-txodds-ip.conf /etc/nginx/sites-available/txodds
sudo ln -sf /etc/nginx/sites-available/txodds /etc/nginx/sites-enabled/txodds
sudo nginx -t
sudo systemctl reload nginx
```

## 5. Install systemd services

Copy the service files and adjust `/opt/solana_coralOS` if needed:

```sh
sudo cp deploy/vps/txodds-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now txodds-api txodds-coral-bus txodds-marketplace txodds-review-panel
```

Check logs:

```sh
journalctl -u txodds-api -f
journalctl -u txodds-coral-bus -f
```

## 6. Firewall

Expose only SSH and HTTP:

```sh
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw enable
```

Do not expose `8801`, `8001`, `3020`, or worker preview ports.

## 7. Smoke test

Open:

```txt
http://YOUR_VPS_IP/system.html
```

Verify:

- DevTools Network has no browser requests to `localhost`
- MCP setup shows `http://YOUR_VPS_IP/mcp`
- bundled worker preview opens under `/previews/`
- graph stays visible through release
- wallet balance modal appears after settlement
