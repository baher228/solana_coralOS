/**
 * Escrow integration tests — run against DEVNET (no local validator needed):
 *
 *   anchor build && anchor deploy --provider.cluster devnet
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=$HOME/.config/solana/id.json \
 *   npx ts-mocha -p ./tsconfig.json -t 1000000 tests/escrow.ts
 *
 * Covers the full lifecycle and the security constraints that make the escrow trustless:
 *   - deposit → release pays the seller (and only the seller)
 *   - a WRONG seller cannot release (has_one)
 *   - refund is rejected before the deadline, allowed after
 */
import * as anchor from '@coral-xyz/anchor'
import { Program, BN } from '@coral-xyz/anchor'
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { assert } from 'chai'
import { escrowPda } from '../client/escrow'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('escrow (devnet)', () => {
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider)
  const program = anchor.workspace.Escrow as Program<any>

  const buyer = (provider.wallet as anchor.Wallet).payer
  const AMOUNT = 0.005 * LAMPORTS_PER_SOL

  it('deposit → release pays exactly the seller', async () => {
    const seller = Keypair.generate()
    const reference = Keypair.generate().publicKey
    const escrow = escrowPda(buyer.publicKey, reference)
    const before = await provider.connection.getBalance(seller.publicKey)

    await program.methods
      .initialize(new BN(AMOUNT), reference, new BN(Math.floor(Date.now() / 1000) + 3600))
      .accountsPartial({ buyer: buyer.publicKey, seller: seller.publicKey, escrow })
      .rpc()

    await program.methods
      .release()
      .accountsPartial({ buyer: buyer.publicKey, seller: seller.publicKey, escrow })
      .rpc()

    const after = await provider.connection.getBalance(seller.publicKey)
    assert.equal(after - before, AMOUNT, 'seller received exactly the escrowed amount')
  })

  it('a wrong seller cannot release the escrow (has_one)', async () => {
    const seller = Keypair.generate()
    const attacker = Keypair.generate()
    const reference = Keypair.generate().publicKey
    const escrow = escrowPda(buyer.publicKey, reference)

    await program.methods
      .initialize(new BN(AMOUNT), reference, new BN(Math.floor(Date.now() / 1000) + 3600))
      .accountsPartial({ buyer: buyer.publicKey, seller: seller.publicKey, escrow })
      .rpc()

    try {
      await program.methods
        .release()
        .accountsPartial({ buyer: buyer.publicKey, seller: attacker.publicKey, escrow })
        .rpc()
      assert.fail('release with the wrong seller should be rejected')
    } catch (e) {
      assert.match(String(e), /WrongSeller|has_one|ConstraintHasOne|2001/i)
    }
  })

  it('refund is rejected before the deadline, then allowed after', async () => {
    const seller = Keypair.generate()
    const reference = Keypair.generate().publicKey
    const escrow = escrowPda(buyer.publicKey, reference)
    // 12s gives margin over devnet clock skew so "before" is reliably before.
    const deadline = Math.floor(Date.now() / 1000) + 12

    await program.methods
      .initialize(new BN(AMOUNT), reference, new BN(deadline))
      .accountsPartial({ buyer: buyer.publicKey, seller: seller.publicKey, escrow })
      .rpc()

    // before the deadline → any error means rejected (that's the behavior we assert)
    let rejected = false
    try {
      await program.methods.refund().accountsPartial({ buyer: buyer.publicKey, escrow }).rpc()
    } catch {
      rejected = true
    }
    assert.isTrue(rejected, 'refund before the deadline must be rejected')

    // wait past the deadline (devnet clock is real time), then refund → succeeds
    await sleep(35_000)
    const before = await provider.connection.getBalance(buyer.publicKey)
    await program.methods.refund().accountsPartial({ buyer: buyer.publicKey, escrow }).rpc()
    const after = await provider.connection.getBalance(buyer.publicKey)
    assert.isAbove(after, before, 'buyer got the deposit + rent back (minus fees)')
  })
})
