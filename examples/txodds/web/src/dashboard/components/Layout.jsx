import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut, Plus, Search } from 'lucide-react'
import { nav } from '../lib/config.js'
import { chatConversations, walletTransactions } from '../lib/selectors.js'
import { Avatar, Icon } from './Common.jsx'

export function Stat({ label, value, sub }) {
  return (
    <div className="escrow-stat">
      <span>{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  )
}

export function Sidebar({ view, setView, data, session }) {
  const counts = data.summary || {}
  const conversations = chatConversations(data.jobs || [], session)
  const transactions = walletTransactions(data.jobs || [], session)
  const badgeFor = (id) => id === 'jobs'
    ? counts.activeJobs
    : id === 'chats'
      ? conversations.filter((item) => item.needsReply).length
      : id === 'wallet'
        ? transactions.length
        : null
  return (
    <aside className="escrow-sidebar">
      <div className="escrow-brand">
        <div className="escrow-mark">FE</div>
        <div><b>Escrow Desk</b><span>Local settlement workspace</span></div>
      </div>
      <button className="escrow-new" onClick={() => setView('jobs')}>
        <Icon icon={Plus} />
        <span>{session.role === 'worker' ? 'Find work' : 'Post job'}</span>
      </button>
      <nav className="escrow-nav">
        {nav.map(([id, label, Glyph]) => (
          <button key={id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>
            <span><Icon icon={Glyph} />{label}</span>
            {badgeFor(id) ? <b>{badgeFor(id)}</b> : null}
          </button>
        ))}
      </nav>
      <div className="escrow-side-note">
        <span>Signed in as</span>
        <b>{session.organization}</b>
        <small>{session.role}</small>
      </div>
    </aside>
  )
}

export function Topbar({ session, onLogout }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onPointer = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <header className="escrow-topbar">
      <div className="escrow-search"><Icon icon={Search} /><input placeholder="Search jobs, clients, references" /></div>
      <div className="escrow-account" ref={menuRef}>
        <button
          type="button"
          className={`escrow-account-trigger ${open ? 'on' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Avatar name={session.name} />
          <span className="escrow-account-id"><b>{session.name}</b><span>{session.organization}</span></span>
          <Icon icon={ChevronDown} size={16} />
        </button>
        {open && (
          <div className="escrow-account-menu" role="menu">
            <div className="escrow-account-menu-head">
              <Avatar name={session.name} />
              <div><b>{session.name}</b><span>{session.email}</span></div>
            </div>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onLogout() }}>
              <Icon icon={LogOut} size={16} />
              <span>Switch account</span>
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

export function AppShell({ session, data, view, setView, error, onLogout, children }) {
  return (
    <div className="escrow-app">
      <Sidebar view={view} setView={setView} data={data} session={session} />
      <section className="escrow-content">
        <Topbar session={session} onLogout={onLogout} />
        {error && <p className="escrow-error">{error}</p>}
        {children}
      </section>
    </div>
  )
}
