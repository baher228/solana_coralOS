import { describe, it, expect, vi } from 'vitest'
import { Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js'
import bs58 from 'bs58'
import { solanaConnection } from './connection.js'
import { generatePaymentUrl, loadKeypairB58, verifyPayment } from './pay.js'

vi.mock('./connection.js', () => ({ solanaConnection: vi.fn() }))

describe('generatePaymentUrl', () => {
  const recipient = Keypair.generate().publicKey.toBase58()

  it('encodes a solana: URL with amount + a fresh reference', () => {
    const p = generatePaymentUrl({
      recipient,
      amountSol: 0.0004,
      message: 'risk-score',
    })
    expect(p.url.startsWith('solana:')).toBe(true)
    expect(p.url).toContain(recipient)
    expect(p.amountSol).toBe(0.0004)
    expect(new PublicKey(p.reference).toBase58()).toBe(p.reference)
  })

  it('mints a unique reference per call (single-use binding)', () => {
    const a = generatePaymentUrl({ recipient, amountSol: 0.0001 })
    const b = generatePaymentUrl({ recipient, amountSol: 0.0001 })
    expect(a.reference).not.toBe(b.reference)
  })

  it('rejects amounts smaller than one lamport', () => {
    expect(() => generatePaymentUrl({ recipient, amountSol: 0.0000000001 })).toThrow(/Invalid amount/)
  })
})

describe('verifyPayment', () => {
  it('accepts only a confirmed SOL transfer carrying the expected reference', async () => {
    const payer = Keypair.generate()
    const recipient = Keypair.generate().publicKey
    const reference = Keypair.generate().publicKey
    const amountSol = 0.001
    const instruction = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports: amountSol * LAMPORTS_PER_SOL,
    })
    instruction.keys.push({
      pubkey: reference,
      isSigner: false,
      isWritable: false,
    })
    const transaction = new Transaction({
      feePayer: payer.publicKey,
      recentBlockhash: Keypair.generate().publicKey.toBase58(),
    }).add(instruction)
    const message = transaction.compileMessage()
    const recipientIndex = message.accountKeys.findIndex((key) => key.equals(recipient))
    const preBalances = message.accountKeys.map(() => 0)
    const postBalances = [...preBalances]
    postBalances[recipientIndex] = amountSol * LAMPORTS_PER_SOL
    vi.mocked(solanaConnection).mockReturnValue({
      getTransaction: vi.fn().mockResolvedValue({
        transaction: { message, signatures: [] },
        meta: { err: null, preBalances, postBalances },
      }),
    } as never)

    await expect(
      verifyPayment('signature', {
        recipient: recipient.toBase58(),
        amountSol,
        reference: reference.toBase58(),
      }),
    ).resolves.toBe(true)
    await expect(
      verifyPayment('signature', {
        recipient: recipient.toBase58(),
        amountSol,
        reference: Keypair.generate().publicKey.toBase58(),
      }),
    ).resolves.toBe(false)
  })
})

describe('loadKeypairB58', () => {
  it('round-trips a base58-encoded secret key from an env var', () => {
    const kp = Keypair.generate()
    process.env.TEST_KP = bs58.encode(kp.secretKey)
    expect(loadKeypairB58('TEST_KP').publicKey.toBase58()).toBe(kp.publicKey.toBase58())
    delete process.env.TEST_KP
  })

  it('throws when the env var is unset', () => {
    delete process.env.MISSING_KP
    expect(() => loadKeypairB58('MISSING_KP')).toThrow(/not set/)
  })
})
