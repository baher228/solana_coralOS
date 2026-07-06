export const API = window.FREELANCE_API
  ?? window.FREELANCE_ESCROW_API
  ?? ''

export const CORAL_BUS = window.CORAL_BUS_API ?? ''

export async function api(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: body == null ? 'GET' : 'POST',
    headers: body == null ? undefined : { 'Content-Type': 'application/json' },
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
