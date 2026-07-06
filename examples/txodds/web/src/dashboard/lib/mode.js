// Workspace mode: a UI lens over one account. Identity stays constant;
// mode decides whether you see the Hiring (buyer) or Working (seller) surface.
const MODE_KEY = 'lance-mode'
export const MODES = ['hiring', 'working']

export function loadMode() {
  try {
    const stored = localStorage.getItem(MODE_KEY)
    return MODES.includes(stored) ? stored : 'hiring'
  } catch {
    return 'hiring'
  }
}

export function saveMode(mode) {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    /* ignore storage failures */
  }
}

// Mode maps onto the existing role-driven machinery: Hiring reads as employer,
// Working reads as worker. This is the lens role, NOT the account identity.
export function roleForMode(mode) {
  return mode === 'working' ? 'worker' : 'employer'
}
