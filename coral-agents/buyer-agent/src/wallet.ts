import {
  Keypair,
  Connection,
  Transaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js'

/**
 * Load the buyer keypair from the `BUYER_KEYPAIR_B58` environment variable.
 *
 * The variable must be a standard base58-encoded 64-byte keypair (the format
 * produced by `solana-keygen new --no-bip39-passphrase`). We decode it here
 * using pure BigInt arithmetic so the buyer-agent package does not need a `bs58`
 * dependency.
 *
 * @throws if the env var is not set or contains an invalid base58 character.
 */
function loadKeypair(): Keypair {
  const b58 = process.env.BUYER_KEYPAIR_B58
  if (!b58) throw new Error('BUYER_KEYPAIR_B58 not set — generate with: solana-keygen new --no-bip39-passphrase')
  // Decode base58 via BigInt — avoids adding a bs58 package dependency.
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let n = BigInt(0)
  for (const c of b58) {
    const idx = ALPHABET.indexOf(c)
    if (idx < 0) throw new Error('Invalid base58 character')
    n = n * BigInt(58) + BigInt(idx)
  }
  const hex = n.toString(16).padStart(128, '0')
  const bytes = new Uint8Array(64)
  for (let i = 0; i < 64; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return Keypair.fromSecretKey(bytes)
}

/**
 * Return the buyer's public key in base58 format.
 * Useful for logging/display without exposing the private key.
 */
export function getBuyerPublicKey(): string {
  return loadKeypair().publicKey.toBase58()
}

/**
 * Parse a `solana:` pay URL, verify the amount is within budget, and broadcast
 * the transfer transaction. Returns the confirmed transaction signature.
 *
 * @param solanaPayUrl - A Solana Pay transfer URL (`solana:<recipient>?amount=X&memo=Y`).
 * @param maxSol       - Maximum SOL the buyer is authorised to spend per call.
 * @throws if the amount is invalid, exceeds `maxSol`, or the transaction fails.
 */
export async function payFromUrl(solanaPayUrl: string, maxSol: number): Promise<string> {
  // Rewrite `solana:` to `solana://` so the URL constructor can parse the hostname.
  const raw = solanaPayUrl.replace(/^solana:/, 'solana://')
  const url = new URL(raw)
  const recipient = new PublicKey(url.hostname || url.pathname.replace(/^\/\//, ''))
  const amountSol = parseFloat(url.searchParams.get('amount') ?? '0')

  if (amountSol <= 0) throw new Error('Invalid amount in Solana Pay URL')
  if (amountSol > maxSol) throw new Error(`Amount ${amountSol} SOL exceeds budget ${maxSol} SOL`)

  const keypair = loadKeypair()
  const conn = new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com')

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: recipient,
      lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
    }),
  )

  const sig = await sendAndConfirmTransaction(conn, tx, [keypair], { commitment: 'confirmed' })
  console.error(`[buyer-agent] paid ${amountSol} SOL → ${recipient.toBase58()} sig=${sig}`)
  return sig
}

/**
 * Send a SOL transfer to `recipient`, optionally tagging it with a Solana Pay `reference`
 * public key (written to the transaction as a ReadOnly account, so the seller can confirm it
 * on-chain via `findReference` without parsing memos). Returns the confirmed signature.
 *
 * This is the payment primitive the LLM buyer uses to satisfy an HTTP 402 challenge.
 *
 * @param recipient - Base58 recipient pubkey from the challenge.
 * @param amountSol - Amount from the challenge (already budget-checked by the caller).
 * @param reference - Optional base58 reference key from the challenge.
 */
export async function signTransfer(recipient: string, amountSol: number, reference?: string): Promise<string> {
  const keypair = loadKeypair()
  const conn = new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com')

  const ix = SystemProgram.transfer({
    fromPubkey: keypair.publicKey,
    toPubkey: new PublicKey(recipient),
    lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
  })
  // Tag the transfer with the reference key as a non-signer, read-only account.
  if (reference) {
    ix.keys.push({ pubkey: new PublicKey(reference), isSigner: false, isWritable: false })
  }

  const tx = new Transaction().add(ix)
  const sig = await sendAndConfirmTransaction(conn, tx, [keypair], { commitment: 'confirmed' })
  console.error(`[buyer-agent] paid ${amountSol} SOL → ${recipient} ref=${reference ?? 'none'} sig=${sig}`)
  return sig
}
