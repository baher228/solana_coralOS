# Escrow program: build, test, deploy

The on-chain escrow program (`programs/escrow`) is the settlement authority for real funds. Treat
changes as security-critical.

## Prerequisites
- Rust stable (>= 1.85; `edition2024` is required by transitive deps)
- Solana CLI (Anza) - provides `cargo-build-sbf` and `solana-test-validator`
- Anchor 0.32.1 (`avm install 0.32.1 && avm use 0.32.1`) - only needed for IDL generation and `anchor test`

## Build
```sh
cd examples/txodds/escrow
cargo-build-sbf            # produces target/deploy/escrow.so
# or, to also generate the IDL + TS types:
anchor build
```
CI builds the program on every PR (`escrow-program` job in `.github/workflows/ci.yml`).

## Test
```sh
# Local validator + full lifecycle (arbiter release, approve-blocks-refund, wrong-arbiter, deadlines):
anchor test
# or against devnet (see the header of tests/escrow.ts)
```

## Deploy / upgrade
The program id in `declare_id!` is stable (`R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet`). The
backend fetches the IDL on-chain (`makeProgram` -> `fetchIdl`), so publish the IDL after each deploy.

```sh
anchor build
anchor deploy --provider.cluster devnet
anchor idl init  <program-id> -f target/idl/escrow.json   # first time
anchor idl upgrade <program-id> -f target/idl/escrow.json  # subsequent upgrades
```

### Upgrade authority (production)
Do not leave the program upgrade authority on a single hot key. Transfer it to a multisig
(e.g. Squads) so upgrades require multiple approvers:
```sh
solana program set-upgrade-authority <program-id> --new-upgrade-authority <multisig-address>
```

## Mainnet checklist (gate before real money)
- [ ] External security audit of `programs/escrow/src/lib.rs` completed and findings resolved.
- [ ] Upgrade authority held by a multisig.
- [ ] `ARBITER_KEYPAIR_B58` provided by a KMS/HSM signer, distinct from the funding wallet.
- [ ] `SOLANA_RPC_URL` points at a mainnet endpoint and `ALLOW_MAINNET=1` is set intentionally.
- [ ] Settlement wallets funded with a fee buffer (`SETTLEMENT_FEE_BUFFER_LAMPORTS`).
