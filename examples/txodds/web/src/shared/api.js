export const API = window.FREELANCE_API
  ?? window.FREELANCE_ESCROW_API
  ?? ''

export const CORAL_BUS = window.CORAL_BUS_API ?? ''

const OPERATOR_TOKEN_KEY = 'operatorToken'

// Single-operator API key. Persisted in localStorage (or injected via
// window.OPERATOR_TOKEN) and sent as a Bearer token so the dashboard keeps
// working when the backend has OPERATOR_TOKEN configured.
export function operatorToken() {
  if (typeof window !== 'undefined' && window.OPERATOR_TOKEN) return String(window.OPERATOR_TOKEN)
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(OPERATOR_TOKEN_KEY)) || ''
  } catch {
    return ''
  }
}

export function setOperatorToken(token) {
  try {
    if (token) localStorage.setItem(OPERATOR_TOKEN_KEY, token)
    else localStorage.removeItem(OPERATOR_TOKEN_KEY)
  } catch {}
}

export async function api(path, body) {
  const headers = {}
  if (body != null) headers['Content-Type'] = 'application/json'
  const token = operatorToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API}${path}`, {
    method: body == null ? 'GET' : 'POST',
    headers: Object.keys(headers).length ? headers : undefined,
    body: body == null ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {}
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

export function stopBubble(event) {
  event?.stopPropagation()
}

export function short(value) {
  if (!value) return '--'
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
}
