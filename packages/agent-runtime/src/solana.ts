import { Connection } from '@solana/web3.js'

/** Default devnet endpoint — every agent falls back to this when SOLANA_RPC_URL is unset. */
export const DEVNET_RPC = 'https://api.devnet.solana.com'

/**
 * Guard against an agent signing real value on mainnet by accident. Throws if `url` looks like a
 * mainnet endpoint, unless `ALLOW_MAINNET=1` is set. This kit is devnet-only; the override exists
 * for deliberate, eyes-open use — never with a funded mainnet key.
 */
export function assertDevnet(url: string = process.env.SOLANA_RPC_URL ?? DEVNET_RPC): void {
  if (process.env.ALLOW_MAINNET === '1') return
  if (/mainnet/i.test(url)) {
    throw new Error(
      `Refusing mainnet RPC "${url}" — this kit is devnet-only. ` +
        `Set ALLOW_MAINNET=1 to override (never with a funded key).`,
    )
  }
}

/**
 * Devnet-guarded `Connection` factory. Use this instead of `new Connection(...)` anywhere an agent
 * sends or verifies a payment, so a stray mainnet `SOLANA_RPC_URL` can't move real SOL.
 */
export function solanaConnection(url: string = process.env.SOLANA_RPC_URL ?? DEVNET_RPC): Connection {
  assertDevnet(url)
  return new Connection(url, 'confirmed')
}
