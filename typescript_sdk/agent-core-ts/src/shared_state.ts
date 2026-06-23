import type { SharedStateEntry, StateChange } from './types.js'

const MAX_HISTORY = 500

export class SharedState {
  private _store = new Map<string, SharedStateEntry>()
  private _history: StateChange[] = []

  set(key: string, value: unknown, changedBy: string): boolean {
    const old = this._store.get(key) ?? null
    const version = old ? old.version + 1 : 1
    const entry: SharedStateEntry = {
      value, last_modified: new Date().toISOString(),
      modified_by: changedBy, version,
    }
    this._store.set(key, entry)
    this._history.push({
      key, old_value: old?.value ?? null, new_value: value,
      timestamp: new Date().toISOString(), changed_by: changedBy,
    })
    if (this._history.length > MAX_HISTORY) {
      this._history.splice(0, this._history.length - MAX_HISTORY)
    }
    return true
  }

  get(key: string): SharedStateEntry | undefined { return this._store.get(key) }

  getAll(): Record<string, SharedStateEntry> {
    return Object.fromEntries(this._store)
  }

  delete(key: string, changedBy: string): boolean {
    const old = this._store.get(key)
    if (!old) return false
    this._store.delete(key)
    this._history.push({
      key, old_value: old.value, new_value: null,
      timestamp: new Date().toISOString(), changed_by: changedBy,
    })
    return true
  }

  history(): StateChange[] { return [...this._history] }
}
