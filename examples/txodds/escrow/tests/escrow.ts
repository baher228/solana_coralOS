/**
 * Escrow integration tests — run against DEVNET (no local validator needed):
 *
 *   anchor build && anchor deploy --provider.cluster devnet
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=$HOME/.config/solana/id.json \
 *   npx ts-mocha -p ./tsconfig.json -t 1000000 tests/escrow.ts
 *
 * Covers the full lifecycle and the security constraints the escrow depends on:
 *   - deposit → release pays the seller (and only the seller)
 *   - a WRONG seller / WRONG arbiter cannot release (has_one)
 *   - the arbiter can release funds to the seller
 *   - once the arbiter approves, refunds are blocked (approved work can't be reclaimed)
 *   - refund is rejected before the deadline, allowed after (when not approved)
 */
import * as anchor from '@coral-xyz/anchor'
import { Program, BN } from '@coral-xyz/anchor'
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { assert } from 'chai'
import { escrowPda } from '../client/escrow'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const soon = (secs: number) => new BN(Math.floor(Date.now() / 1000) + secs)

describe('escrow (devnet)', () => {
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider)
  const program = anchor.workspace.Escrow as Program<any>

  const buyer = (provider.wallet as anchor.Wallet).payer
  const AMOUNT = 0.005 * LAMPORTS_PER_SOL

  it('deposit → release pays exactly the seller', async () => {
    const seller = Keypair.generate()
    const arbiter = Keypair.generate()
    const reference = Keypair.generate().publicKey
    const escrow = escrowPda(buyer.publicKey, reference)
    const before = await provider.connection.getBalance(seller.publicKey)

    await program.methods
      .initialize(new BN(AMOUNT), reference, soon(3600))
      .accountsPartial({ buyer: buyer.publicKey, seller: seller.publicKey, arbiter: arbiter.publicKey, escrow })
      .rpc()

    await program.methods
      .release()
      .accountsPartial({ buyer: buyer.publicKey, seller: seller.publicKey, arbiter: arbiter.publicKey, escrow })
      .rpc()

    const after = await provider.connection.getBalance(seller.publicKey)
    assert.equal(after - before, AMOUNT, 'seller received exactly the escrowed amount')
  })

  it('the arbiter can release funds to the seller', async () => {
    const seller = Keypair.generate()
    const arbiter = Keypair.generate()
    const reference = Keypair.generate().publicKey
    const escrow = escrowPda(buyer.publicKey, reference)
    const before = await provider.connection.getBalance(seller.publicKey)

    await program.methods
      .initialize(new BN(AMOUNT), reference, soon(3600))
      .accountsPartial({ buyer: buyer.publicKey, seller: seller.publicKey, arbiter: arbiter.publicKey, escrow })
      .rpc()

    await program.methods
      .release()
      .accountsPartial({ buyer: buyer.publicKey, seller: seller.publicKey, arbiter: arbiter.publicKey, escrow })
      .signers([arbiter])
      .rpc()

    const after = await provider.connection.getBalance(seller.publicKey)
    assert.equal(after - before, AMOUNT, 'arbiter-signed release paid the seller')
  })

  it('a wrong seller cannot release the escrow (has_one)', async () => {
    const seller = Keypair.generate()
    const arbiter = Keypair.generate()
    const attacker = Keypair.generate()
    const reference = Keypair.generate().publicKey
    const escrow = escrowPda(buyer.publicKey, reference)

    await program.methods
      .initialize(new BN(AMOUNT), reference, soon(3600))
      .accountsPartial({ buyer: buyer.publicKey, seller: seller.publicKey, arbiter: arbiter.publicKey, escrow })
      .rpc()

    try {
      await program.methods
        .release()
        .accountsPartial({ buyer: buyer.publicKey, seller: attacker.publicKey, arbiter: arbiter.publicKey, escrow })
        .rpc()
      assert.fail('release with the wrong seller should be rejected')
    } catch (e) {
      assert.match(String(e), /WrongSeller|has_one|ConstraintHasOne|2006|2001/i)
    }
  })

  it('a wrong arbiter cannot release the escrow (has_one)', async () => {
    const seller = Keypair.generate()
    const arbiter = Keypair.generate()
    const attacker = Keypair.generate()
    const reference = Keypair.generate().publicKey
    const escrow = escrowPda(buyer.publicKey, reference)

    await program.methods
      .initialize(new BN(AMOUNT), reference, soon(3600))
      .accountsPartial({ buyer: buyer.publicKey, seller: seller.publicKey, arbiter: arbiter.publicKey, escrow })
      .rpc()

    try {
      await program.methods
        .release()
        .accountsPartial({ buyer: buyer.publicKey, seller: seller.publicKey, arbiter: attacker.publicKey, escrow })
        .rpc()
      assert.fail('release with the wrong arbiter should be rejected')
    } catch (e) {
      assert.match(String(e), /WrongArbiter|has_one|ConstraintHasOne|2006|2001/i)
    }
  })

  it('once approved, the escrow can no longer be refunded', async () => {
    const seller = Keypair.generate()
    const arbiter = Keypair.generate()
    const reference = Keypair.generate().publicKey
    const escrow = escrowPda(buyer.publicKey, reference)
    // Short deadline so the "after deadline" refund path is reachable.
    const deadline = Math.floor(Date.now() / 1000) + 12

    await program.methods
      .initialize(new BN(AMOUNT), reference, new BN(deadline))
      .accountsPartial({ buyer: buyer.publicKey, seller: seller.publicKey, arbiter: arbiter.publicKey, escrow })
      .rpc()

    await program.methods
      .approve()
      .accountsPartial({ arbiter: arbiter.publicKey, escrow })
      .signers([arbiter])
      .rpc()

    await sleep(35_000) // wait past the deadline

    try {
      await program.methods
        .refund()
        .accountsPartial({ buyer: buyer.publicKey, arbiter: arbiter.publicKey, escrow })
        .rpc()
      assert.fail('refund after approval should be rejected')
    } catch (e) {
      assert.match(String(e), /AlreadyApproved|6009|approved/i)
    }
  })

  it('refund is rejected before the deadline, then allowed after', async () => {
    const seller = Keypair.generate()
    const arbiter = Keypair.generate()
    const reference = Keypair.generate().publicKey
    const escrow = escrowPda(buyer.publicKey, reference)
    const deadline = Math.floor(Date.now() / 1000) + 12

    await program.methods
      .initialize(new BN(AMOUNT), reference, new BN(deadline))
      .accountsPartial({ buyer: buyer.publicKey, seller: seller.publicKey, arbiter: arbiter.publicKey, escrow })
      .rpc()

    let rejected = false
    try {
      await program.methods.refund().accountsPartial({ buyer: buyer.publicKey, arbiter: arbiter.publicKey, escrow }).rpc()
    } catch {
      rejected = true
    }
    assert.isTrue(rejected, 'refund before the deadline must be rejected')

    await sleep(35_000)
    const before = await provider.connection.getBalance(buyer.publicKey)
    await program.methods.refund().accountsPartial({ buyer: buyer.publicKey, arbiter: arbiter.publicKey, escrow }).rpc()
    const after = await provider.connection.getBalance(buyer.publicKey)
    assert.isAbove(after, before, 'buyer got the deposit + rent back (minus fees)')
  })
})
