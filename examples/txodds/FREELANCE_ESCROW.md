# Freelance Escrow API Notes

The API is deliberately small. Jobs live in memory while the process runs and are saved to the
gitignored local JSON file `examples/txodds/.data/jobs.json`.

## State

`GET /api/health` returns readiness, devnet RPC, configured wallets, version, and timestamp without
performing on-chain balance reads.

`GET /api/state` returns:

- jobs and selected job
- wallet addresses and devnet balances
- network metadata
- settlement links for reference, vault, escrow PDA, open, release, and refund
- funding quote, review history, disputes, and audit events

`POST /api/quote` returns the funding estimate before job creation:

- job budget
- escrow account rent
- arbiter top-up if the arbiter is below `0.01 SOL`
- total estimated employer debit, excluding variable network fees

Before funding, the API checks that `ARBITER_KEYPAIR_B58` matches the deployed arbiter program's
one-time on-chain config. A mismatch fails the job before escrow funding so funds are not locked behind
an arbiter signer that cannot settle them.

## Flow

1. `POST /api/jobs` creates the job and calls the arbiter `open` instruction.
2. `POST /api/jobs/:id/messages` appends employer/worker chat.
3. `POST /api/jobs/:id/submission` records URL, repo, and notes.
4. `POST /api/jobs/:id/review` reviews task requirements, acceptance criteria, chat, and submission.
5. If funding fails, `POST /api/jobs/:id/fund` retries the same escrow after the employer wallet is funded.
6. Approved reviews call `arbitrate_release`; rejected reviews stay available for dispute/refund.
7. If release fails after approval, `POST /api/jobs/:id/release` retries release without rerunning review.
8. `POST /api/jobs/:id/dispute` records a note and reruns review.
9. `POST /api/jobs/:id/refund` calls `arbitrate_refund` after the deadline.

The review result includes per-criterion scores, confidence, missing criteria, and release reasoning.
The deterministic fallback is evidence-based text matching only; it does not clone repositories, run
builds, or inspect live URLs.
