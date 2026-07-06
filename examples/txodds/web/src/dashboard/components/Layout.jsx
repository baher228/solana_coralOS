import React from 'react'
import { Plus, RefreshCw, Search } from 'lucide-react'
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
      <div className="escrow-side-tools">
        <a href="./legacy.html">Legacy demo</a>
      </div>
    </aside>
  )
}

export function Topbar({ session, refresh, busy, onLogout }) {
  return (
    <header className="escrow-topbar">
      <div className="escrow-search"><Icon icon={Search} /><input placeholder="Search jobs, clients, references" /></div>
      <div className="escrow-account">
        <button className="escrow-ghost iconed" disabled={busy} onClick={refresh}><Icon icon={RefreshCw} /><span>Refresh</span></button>
        <Avatar name={session.name} />
        <div><b>{session.name}</b><span>{session.email}</span></div>
        <button className="escrow-ghost" onClick={onLogout}>Switch account</button>
      </div>
    </header>
  )
}

export function AppShell({ session, data, view, setView, refresh, busy, error, onLogout, children }) {
  return (
    <div className="escrow-app">
      <Sidebar view={view} setView={setView} data={data} session={session} />
      <section className="escrow-content">
        <Topbar session={session} refresh={refresh} busy={busy} onLogout={onLogout} />
        {error && <p className="escrow-error">{error}</p>}
        {children}
      </section>
    </div>
  )
}
