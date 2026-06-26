import { describe, it, expect, afterEach } from 'vitest'
import { assertDevnet } from './solana.js'

const original = process.env.ALLOW_MAINNET
afterEach(() => {
  if (original === undefined) delete process.env.ALLOW_MAINNET
  else process.env.ALLOW_MAINNET = original
})

describe('assertDevnet — mainnet guard', () => {
  it('allows devnet endpoints', () => {
    expect(() => assertDevnet('https://api.devnet.solana.com')).not.toThrow()
    expect(() => assertDevnet('https://devnet.helius-rpc.com/?api-key=x')).not.toThrow()
  })

  it('rejects a mainnet endpoint', () => {
    delete process.env.ALLOW_MAINNET
    expect(() => assertDevnet('https://api.mainnet-beta.solana.com')).toThrow(/devnet-only/i)
    expect(() => assertDevnet('https://mainnet.helius-rpc.com/?api-key=x')).toThrow(/mainnet/i)
  })

  it('allows mainnet only with ALLOW_MAINNET=1', () => {
    process.env.ALLOW_MAINNET = '1'
    expect(() => assertDevnet('https://api.mainnet-beta.solana.com')).not.toThrow()
  })
})
