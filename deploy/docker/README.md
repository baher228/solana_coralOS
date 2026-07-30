# Container deployment

A production-like stack: PostgreSQL + API + nginx (serving the built dashboard and
reverse-proxying `/api` and `/mcp` to the API).

## Run
```sh
export POSTGRES_PASSWORD=...          # required
export OPERATOR_TOKEN=...             # required (single-operator API key)
export BUYER_KEYPAIR_B58=...          # settlement funding key (secret manager)
export ARBITER_KEYPAIR_B58=...        # settlement authority (KMS/secret manager)
docker compose -f deploy/docker/docker-compose.yml up --build
```
The dashboard is on `http://<host>/`; the API on `http://<host>/api/`. Put TLS in
front (see `deploy/vps/nginx-txodds-tls.conf`, a load balancer, or add certbot).

## Secrets
Never bake secrets into images. Inject `OPERATOR_TOKEN`, `POSTGRES_PASSWORD`,
`BUYER_KEYPAIR_B58`, and `ARBITER_KEYPAIR_B58` from your platform's secret manager
(Docker/Swarm secrets, Kubernetes Secrets, SSM, Vault, etc.). In production the
arbiter key should be served by a KMS/HSM signer rather than an env var.

## Migrations
The API runs idempotent schema migrations (`CREATE TABLE IF NOT EXISTS`) on startup
against `DATABASE_URL`, so no separate migration step is required for this schema.

## Backups / DR
- Nightly logical backup:
  ```sh
  docker compose -f deploy/docker/docker-compose.yml exec postgres \
    pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > backup-$(date +%F).sql.gz
  ```
- Restore:
  ```sh
  gunzip -c backup-YYYY-MM-DD.sql.gz | \
    docker compose -f deploy/docker/docker-compose.yml exec -T postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"
  ```
- The `settlement_outbox` table is the audit trail for on-chain fund movements; retain backups
  accordingly. For real funds, also snapshot the DB before program upgrades or key rotation.

## Zero-downtime
Run multiple `api` replicas behind the proxy; only the replica holding the Postgres
advisory leader lock runs the settlement tick, so scaling out will not double-settle.
```
