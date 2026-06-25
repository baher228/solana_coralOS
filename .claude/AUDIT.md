# Codebase Audit — Modular · Idiomatic · No Dead Code · Documented

**Date:** 2026-06-25
**Method:** Full-tree scan (stale references, dead/commented code, build artifacts), typecheck of
every package, and a module-boundary review. Excludes `ref/` (cloned upstream, gitignored) and
`.claude/*` (planning snapshots).

---

## Verdict

| Dimension | State | Notes |
|---|---|---|
| **Correctness** | ✅ | All 9 packages typecheck with **0 real errors** (api-server has only pre-existing vitest/supertest test-dep gaps). |
| **Modular** | ✅ | Strategy pattern, clean `AgentManager`/`Strategy`/`MessageBus`/`SharedState` boundaries; tracks are self-contained (own `package.json`). No cross-track coupling. |
| **Documented** | ✅ (mostly) | JSDoc on every SDK public surface (added in the earlier refactor). Gaps are in stale prose, not missing docs. |
| **No dead code** | ⚠️ → fixing | A few **stale references to removed components** (the old Rust `api/`, port `:8080`, and the dropped tracks). Listed below. |

The repo is in good structural shape. The audit's real work is **stale-reference cleanup** left
over from removing the Rust backend, the agent-trading track, and the native-x402 surface.

---

## Findings & fixes

### F1 — Wrong default API port (functional bug) — `web/lib/coral.ts`
`NEXT_PUBLIC_CORAL_SERVER ?? 'http://localhost:8080'` — api-server runs on **8081**. A dev who doesn't
set the env var hits the wrong port. **Fix:** default → `:8081`.

### F2 — Stale `:8080` / Rust-backend references across docs (the removed Rust `api/`)
- `web/README.md` — `cd ../api && cargo run`, `api/ (Rust/Axum :8080)`, `:8080` throughout.
- `packages/agent-runtime/README.md`, `sdk/sdk/README.md` — `:8080` in code examples.
- `sdk/sdk/README.md` — a `new CoralClient({ baseUrl })` example, but the constructor takes a
  **string**, not an object (doubly wrong: stale port + wrong API shape).

The Rust `api/` is gone; the backend is `api-server` on `:8081`. **Fixed:** rewrote `web/README.md` to
api-server/`:8081`; `:8080 → :8081` across both SDK READMEs; corrected the `CoralClient(...)` example to
the real string-arg constructor. Verified: zero `:8080` left in active code/docs.

### F3 — Commented-out strategy imports — `api-server/src/registry.ts`
Two commented `import` lines for `TransferStrategy` / `HeliusMonitorStrategy`. These are
*intentional opt-in scaffolding* (the strategies exist; they need `@solana/web3.js` installed).
**Decision:** keep, but make the comment state plainly that they're optional opt-ins, not dead code.

### F4 — Historical planning docs with stale paths — `docs/{ULTIMATE_PLAN,RESTRUCTURE_PLAN,COMPLETENESS_PLAN,anchor-wallet-demo}.md`
Contain old `cargo`/`agent_demo/`/`:8080` references. These are **dated design snapshots**, not
user-facing run docs. **Decision:** leave as historical record (rewriting them would falsify the
snapshot); the *active* docs (READMEs, CLAUDE.md) are what get fixed.

### F5 — On-disk `dist/` build output (not a problem)
`packages/agent-runtime/dist/` exists on disk but is **gitignored and untracked** — verified `git ls-files
dist` = 0. No action.

---

## Fix list — DONE
1. ✅ `web/lib/coral.ts` — default port `8080` → `8081`.
2. ✅ `web/README.md` — rewritten to api-server/`:8081` (removed all Rust/cargo references).
3. ✅ `packages/agent-runtime/README.md` + `sdk/sdk/README.md` — `:8080` → `:8081`; fixed the
   `CoralClient(...)` constructor example (string, not object).
4. ✅ `api-server/src/registry.ts` — left as-is; the comment already frames the commented Solana
   strategies as opt-in scaffolding (not dead code).
5. ✅ Re-typecheck — all packages still **0 real errors**; zero `:8080` in active code/docs.

---

## What's left to *harden* this (beyond the audit)

The kit is a clean, working **devnet teaching scaffold**. To make it production-grade:

| Area | Gap | Hardening |
|---|---|---|
| **Tests** | Only smoke scripts + one api-server test. | Unit tests for `verify.ts`, the 402 challenge/parse, `LLMBuyerStrategy` budget guard; an e2e for each track. Wire `npm test` into CI. |
| **CI** | No automated typecheck/test on push. | GitHub Action: typecheck every package + run tests + `npm audit`. (A `.github/workflows/ci.yml` exists — confirm it covers the new tracks.) |
| **Server robustness** | Bare-metal seller had an unhandled-rejection crash (fixed). Others may share it. | Audit every `await fetch`/RPC call for try/catch; add request timeouts; a global Express error handler. |
| **Replay/abuse** | The 402 reference key isn't nonce-tracked; a sig could be replayed within a memo window. | Track consumed references server-side; reject reused proofs. Rate-limit the seller endpoints. |
| **Secrets** | Keys live in `.env`; buyer keypair is base58 in env. | Document key handling; consider a secrets manager for any non-devnet use; never log keys. |
| **Provider lock-in** | LLM calls are Anthropic-only. | Make `LLMBuyerStrategy` + seller inference provider-flexible (`OPENAI_API_KEY` | `ANTHROPIC_API_KEY`). (Open question already noted.) |
| **Mainnet path** | Everything is devnet-hardcoded. | A config flag + funded-wallet guardrails before any mainnet use. Currently intentionally devnet-only. |
| **Observability** | `console.error` prefixed logs + the `log.ts` JSON mode. | Structured logging end-to-end; surface agent action logs to the dashboards. |

**Priority order if hardening:** tests + CI (catches regressions) → server robustness (don't crash
on upstream failure) → replay/rate-limit (the one real security gap) → the rest.
