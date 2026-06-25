# Contributing

Contributions are welcome. The `main` branch is the integration branch — target all PRs at `main`.

## Repo Layout

| Directory | Language | Typical changes |
|-----------|----------|-----------------|
| `packages/agent-runtime/` | TypeScript | New strategies, Solana Pay logic, messaging, workflows |
| `api-server/` | TypeScript (Express) | New REST endpoints, handler logic |
| `packages/coral-client/` | TypeScript | CoralClient HTTP wrapper |
| `web/` | TypeScript (Next.js) | Consumer marketplace UI |
| `coral-agents/` | Python | CoralOS MCP agents |

## Prerequisites

- Node.js 20+
- Python 3.11+ (for coral-agents)
- Docker Desktop (for CoralOS)

## Development Commands

### TypeScript

```sh
cd api-server && npm install && npm run dev    # Express API on :8081
cd web && npm install && npm run dev       # Next.js on :3000
cd packages/agent-runtime && npm run typecheck
```

## PR Workflow

1. Open an issue or comment on an existing one to discuss your change.
2. Fork the repo and create a feature branch from `main`.
3. Make your change. Add tests for new behavior.
4. Run lint and typecheck locally before pushing.
5. Use [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.).
6. Open a PR against `main`.

## Code Style

- **TypeScript:** run `npm run typecheck && npm test` in `packages/agent-runtime/` and `api-server/` before committing.
- **Documentation:** READMEs should explain *why* a module exists, not just *what* it does.

## Security

See [SECURITY.md](./SECURITY.md) for the security policy and vulnerability reporting process.
