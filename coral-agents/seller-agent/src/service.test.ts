import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { deliverService } from './service.js'

// deliverService routes on the FIRST token of the request when it names a known service, else falls
// back to the SERVICE env. External APIs are mocked so these are fast, offline unit tests.
describe('deliverService routing', () => {
  const realFetch = global.fetch
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.NEWS_API_KEY
    delete process.env.SERVICE
  })
  afterEach(() => {
    global.fetch = realFetch
    vi.restoreAllMocks()
  })

  const mockJson = (body: unknown) =>
    (global.fetch = vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch)

  it('routes on the first token, overriding the SERVICE env', async () => {
    process.env.SERVICE = 'jupiter' // env says jupiter…
    mockJson({ solana: { usd: 152.5 } })
    const out = JSON.parse(await deliverService('coingecko')) // …but the request asks for coingecko
    expect(out.coin).toBe('solana')
    expect(out.usd).toBe(152.5)
  })

  it('coingecko picks ethereum when the request mentions eth', async () => {
    mockJson({ ethereum: { usd: 3000 } })
    const out = JSON.parse(await deliverService('coingecko eth price'))
    expect(out.coin).toBe('ethereum')
  })

  it('inference without ANTHROPIC_API_KEY returns a clear error (never crashes)', async () => {
    const out = JSON.parse(await deliverService('inference write a haiku'))
    expect(out.error).toMatch(/ANTHROPIC_API_KEY/)
  })

  it('news without NEWS_API_KEY returns a clear error', async () => {
    const out = JSON.parse(await deliverService('news solana'))
    expect(out.error).toMatch(/NEWS_API_KEY/)
  })

  it('falls back to the SERVICE env when the first token is not a known service', async () => {
    process.env.SERVICE = 'coingecko'
    mockJson({ solana: { usd: 100 } })
    const out = JSON.parse(await deliverService('what is the price right now'))
    expect(out.coin).toBe('solana') // used env=coingecko, not the words in the request
  })
})
