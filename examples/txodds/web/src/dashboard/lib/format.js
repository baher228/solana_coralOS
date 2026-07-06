export function statusText(status) {
  return String(status || 'none').replace(/_/g, ' ')
}

export function money(value) {
  return `${Number(value || 0).toFixed(3)} SOL`
}

export function moneyMaybe(value) {
  return value == null ? '--' : money(value)
}

export function short(value) {
  return value ? `${String(value).slice(0, 6)}...${String(value).slice(-4)}` : '--'
}

export function formatTime(value) {
  return value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--'
}

export function party(value) {
  const text = String(value || '')
  return text.length > 28 && !text.includes(' ') ? short(text) : text
}

export function initials(name) {
  return String(name || 'User').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'U'
}

export function accountDraft(account) {
  return {
    accountId: account.id || 'custom',
    name: account.name || '',
    email: account.email || '',
    organization: account.organization || '',
    role: account.role || 'employer',
  }
}
