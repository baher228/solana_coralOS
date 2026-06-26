import { describe, it, expect } from 'vitest'
import { parseMention } from './coral_mcp.js'

describe('parseMention — CoralOS response shapes', () => {
  it('nested messages[] (current CoralOS format)', () => {
    const m = parseMention(JSON.stringify({
      threadId: 't1',
      messages: [{ senderName: 'buyer-agent', text: 'request risk-score' }],
    }))
    expect(m).toEqual({ threadId: 't1', sender: 'buyer-agent', text: 'request risk-score' })
  })

  it('single message object', () => {
    const m = parseMention(JSON.stringify({
      message: { threadId: 't2', sender: 'seller-agent', content: 'PAYMENT_REQUIRED' },
    }))
    expect(m.threadId).toBe('t2')
    expect(m.sender).toBe('seller-agent')
    expect(m.text).toBe('PAYMENT_REQUIRED')
  })

  it('flat text/content at top level', () => {
    const m = parseMention(JSON.stringify({ threadId: 't3', senderName: 'x', text: 'paid <sig>' }))
    expect(m.text).toBe('paid <sig>')
  })

  it('timeout response → empty text (caller treats as null)', () => {
    expect(parseMention(JSON.stringify({ status: 'Timeout reached' })).text).toBe('')
  })

  it('non-JSON raw → used as text verbatim', () => {
    expect(parseMention('plain string').text).toBe('plain string')
  })
})
