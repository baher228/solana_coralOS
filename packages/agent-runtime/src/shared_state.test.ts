import { describe, it, expect } from 'vitest'
import { SharedState } from './shared_state.js'

describe('SharedState', () => {
  it('set and get a value', () => {
    const state = new SharedState()
    state.set('key', 'hello', 'agent-1')
    const entry = state.get('key')!
    expect(entry.value).toBe('hello')
    expect(entry.version).toBe(1)
    expect(entry.modified_by).toBe('agent-1')
  })

  it('increments version on update', () => {
    const state = new SharedState()
    state.set('x', 1, 'a')
    state.set('x', 2, 'b')
    const entry = state.get('x')!
    expect(entry.version).toBe(2)
    expect(entry.value).toBe(2)
    expect(entry.modified_by).toBe('b')
  })

  it('delete removes the key', () => {
    const state = new SharedState()
    state.set('del', true, 'a')
    state.delete('del', 'a')
    expect(state.get('del')).toBeUndefined()
  })

  it('delete returns false for missing key', () => {
    const state = new SharedState()
    expect(state.delete('missing', 'a')).toBe(false)
  })

  it('getAll returns all entries', () => {
    const state = new SharedState()
    state.set('a', 1, 'x')
    state.set('b', 2, 'x')
    const all = state.getAll()
    expect(Object.keys(all)).toHaveLength(2)
    expect(all['a'].value).toBe(1)
    expect(all['b'].value).toBe(2)
  })

  it('history records writes and deletes', () => {
    const state = new SharedState()
    state.set('h', 1, 'a')
    state.set('h', 2, 'b')
    state.delete('h', 'c')
    const hist = state.history()
    expect(hist).toHaveLength(3)
    expect(hist[0].new_value).toBe(1)
    expect(hist[1].old_value).toBe(1)
    expect(hist[2].new_value).toBeNull()
  })
})
