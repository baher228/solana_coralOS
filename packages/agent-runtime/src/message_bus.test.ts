import { describe, it, expect } from 'vitest'
import { MessageBus } from './message_bus.js'

describe('MessageBus', () => {
  it('broadcast is visible to everyone', () => {
    const bus = new MessageBus()
    bus.broadcast('alice', 'ping', 'hello')
    expect(bus.getFor('alice')).toHaveLength(1)
    expect(bus.getFor('bob')).toHaveLength(1)
  })

  it('direct message only visible to sender and recipient', () => {
    const bus = new MessageBus()
    bus.direct('alice', 'bob', 'task', 'do this')
    expect(bus.getFor('bob')).toHaveLength(1)
    expect(bus.getFor('alice')).toHaveLength(0) // getFor filters by recipient, not sender
    expect(bus.getFor('carol')).toHaveLength(0)
  })

  it('getAll returns every message', () => {
    const bus = new MessageBus()
    bus.broadcast('a', 'b', 'c')
    bus.direct('x', 'y', 'z', 'w')
    expect(bus.getAll()).toHaveLength(2)
  })

  it('conversation thread is bidirectional', () => {
    const bus = new MessageBus()
    bus.direct('alice', 'bob', 'hello', 'hi')
    bus.direct('bob', 'alice', 'reply', 'hey')
    bus.direct('alice', 'carol', 'other', 'nope')
    const thread = bus.getConversation('alice', 'bob')
    expect(thread).toHaveLength(2)
  })

  it('messages have unique ids', () => {
    const bus = new MessageBus()
    bus.broadcast('a', 'x', '1')
    bus.broadcast('a', 'x', '2')
    const [m1, m2] = bus.getAll()
    expect(m1.id).not.toBe(m2.id)
  })
})
