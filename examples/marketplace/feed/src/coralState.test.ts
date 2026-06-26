import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { collectMessages } from './coralState.js'
import { foldRounds } from './foldRounds.js'

// A REAL CoralOS extended-state response, captured from a settled devnet round (tests/coral-session.json).
const state = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'coral-session.json'), 'utf8'),
)

describe('collectMessages + foldRounds on a REAL coral transcript', () => {
  const messages = collectMessages(state)

  it('extracts thread messages from coral’s real extended-state shape', () => {
    expect(messages.length).toBeGreaterThanOrEqual(8)
    expect(messages[0]).toMatchObject({ sender: 'buyer-agent' })
    expect(messages[0].text).toContain('WANT round=1')
  })

  it('folds the real transcript into a settled round', () => {
    const [r] = foldRounds(messages, ['seller-cheap', 'seller-premium', 'seller-lazy'])
    expect(r.round).toBe(1)
    expect(r.bids).toHaveLength(2)
    expect(r.award?.to).toBe('seller-cheap')
    expect(r.award?.reason).toBeTruthy() // the AWARD reason tweak survives the round-trip
    expect(r.status).toBe('settled')
    expect(r.release?.sig).toBeTruthy()
    expect(r.declined).toContain('seller-lazy') // it sat out coingecko — self-selection
  })
})
