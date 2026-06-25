import type { SharedStateEntry, StateChange } from './types.js'

/** Maximum number of change-history entries retained. Oldest entries are evicted first. */
const MAX_HISTORY = 500

/**
 * Versioned key-value store shared across all agents in one `AgentManager`.
 *
 * Every write increments the entry's `version` and appends to a bounded change log,
 * giving agents a simple audit trail of who changed what and when.
 */
export class SharedState {
  private _store = new Map<string, SharedStateEntry>()
  private _history: StateChange[] = []

  /**
   * Create or update a key. Increments `version` on each write.
   * Always returns `true` (permission enforcement is handled at the manager layer).
   *
   * @param key       - Arbitrary string key; use `/`-separated namespaces (e.g. `"market/AAPL"`).
   * @param value     - Any JSON-serialisable value.
   * @param changedBy - Agent ID or system actor responsible for the write.
   */
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

  /** Return the current entry for `key`, or `undefined` if the key does not exist. */
  get(key: string): SharedStateEntry | undefined { return this._store.get(key) }

  /** Return all entries as a plain object (suitable for JSON serialisation). */
  getAll(): Record<string, SharedStateEntry> {
    return Object.fromEntries(this._store)
  }

  /**
   * Delete a key and record the deletion in history.
   * @returns `false` if the key did not exist; `true` otherwise.
   */
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

  /** Return a copy of the bounded change-history log, oldest first. */
  history(): StateChange[] { return [...this._history] }
}
