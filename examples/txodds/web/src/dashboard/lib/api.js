import { api as request } from '../../shared/api.js'
import { ACCOUNTS_URL, DEFAULT_ACCOUNTS } from './config.js'

export { API } from '../../shared/api.js'

export function api(path, body) {
  return request(path, body)
}

export async function loadAccounts() {
  try {
    const res = await fetch(ACCOUNTS_URL, { cache: 'no-store' })
    if (!res.ok) throw new Error('accounts unavailable')
    const data = await res.json()
    const accounts = Array.isArray(data) ? data : data.accounts
    return accounts?.length ? accounts : DEFAULT_ACCOUNTS
  } catch {
    return DEFAULT_ACCOUNTS
  }
}
