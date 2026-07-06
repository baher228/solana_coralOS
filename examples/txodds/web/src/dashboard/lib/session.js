import { SESSION_KEY } from './config.js'

export function loadSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
    return session && ['employer', 'worker'].includes(session.role) ? session : null
  } catch {
    return null
  }
}

export function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}
