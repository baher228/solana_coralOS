import React from 'react'
import { initials, statusText } from '../lib/format.js'

export function Badge({ status }) {
  return <span className={`escrow-badge ${status || ''}`}>{statusText(status)}</span>
}

export function Icon({ icon: Glyph, size = 17 }) {
  return <Glyph size={size} strokeWidth={2} aria-hidden="true" />
}

export function Avatar({ name }) {
  return <span className="escrow-avatar">{initials(name)}</span>
}

export function Field({ label, children }) {
  return <label className="escrow-field"><span>{label}</span>{children}</label>
}

export function Empty({ title, body, action }) {
  return (
    <section className="escrow-empty">
      <b>{title}</b>
      <p>{body}</p>
      {action}
    </section>
  )
}
