import type { WorkerConfig } from './config.ts'

export function createApiClient(config: WorkerConfig) {
  return async function api<T = any>(path: string, body?: Record<string, unknown>): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${config.apiToken}` }
    if (body) headers['Content-Type'] = 'application/json'
    const res = await fetch(`${config.apiBase}${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || res.statusText)
    return data as T
  }
}
