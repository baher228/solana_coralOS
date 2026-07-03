import React, { useEffect, useMemo, useRef, useState } from 'https://esm.sh/react@18.3.1'
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client'
import htm from 'https://esm.sh/htm@3.1.1'

const html = htm.bind(React.createElement)
const API = window.FREELANCE_API ?? window.FREELANCE_ESCROW_API ?? 'http://localhost:8801'
const SESSION_KEY = 'freelance-escrow-session'
const THEME_KEY = 'freelance-escrow-theme'
const ACCOUNTS_URL = './accounts.json'
const terminal = new Set(['released', 'refunded', 'cancelled'])
const badStatuses = new Set(['disputed', 'refunded', 'cancelled', 'revision_requested'])

const DEFAULT_ACCOUNTS = [
  { id: 'northstar-employer', role: 'employer', name: 'Ava Hart', email: 'ava@northstar.test', organization: 'Northstar Studio' },
  { id: 'checkout-worker', role: 'worker', name: 'Leo Marin', email: 'leo@checkoutguild.test', organization: 'Checkout Guild' },
  { id: 'rivet-worker', role: 'worker', name: 'Mina Cole', email: 'mina@rivetworks.test', organization: 'Rivet Works' },
]

const NAV = [
  ['marketplace', 'Marketplace', 'grid'],
  ['dashboard', 'Dashboard', 'chart'],
  ['messages', 'Messages', 'chat'],
  ['delivery', 'Delivery', 'box'],
  ['review', 'Review', 'shield'],
  ['payments', 'Payments', 'wallet'],
  ['reputation', 'Reputation', 'star'],
  ['settings', 'Settings', 'sliders'],
]

const LIFECYCLE = ['Posted', 'Funded', 'Delivered', 'Reviewed', 'Released']
const STEP_INDEX = { open: 0, funded: 1, submitted: 2, revision_requested: 3, approved: 3, disputed: 3, released: 4, refunded: 1, cancelled: 0 }

/* ---------------- data helpers ---------------- */
async function api(path, body) {
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

async function loadAccounts() {
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

const loadSession = () => {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
    return s && ['employer', 'worker'].includes(s.role) ? s : null
  } catch { return null }
}
const saveSession = (s) => localStorage.setItem(SESSION_KEY, JSON.stringify(s))

const statusText = (s) => String(s || 'none').replace(/_/g, ' ')
const money = (v) => `${Number(v || 0).toFixed(3)} SOL`
const short = (v) => (v ? `${String(v).slice(0, 6)}...${String(v).slice(-4)}` : '--')
const party = (v) => { const t = String(v || ''); return t.length > 28 && !t.includes(' ') ? short(t) : t }
const initials = (n) => String(n || 'User').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'U'
const when = (d) => { try { return new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }

const isTerminal = (j) => j && terminal.has(j.status)
const isOpen = (j) => j?.status === 'open'
const canClaim = (j, s) => isOpen(j) && s?.role === 'worker'
const canWork = (j) => j && !isOpen(j) && !isTerminal(j) && j.status !== 'disputed'

function nextAction(job) {
  if (!job) return 'Select task'
  return {
    open: 'Waiting for worker', funded: job.submission ? 'Review evidence' : 'Await delivery',
    submitted: 'Review and settle', revision_requested: 'Needs revision', disputed: 'Resolve dispute',
    released: 'Paid out', refunded: 'Refunded', cancelled: 'Cancelled',
  }[job.status] || 'Monitor'
}

function filterJobs(jobs, query) {
  const q = query.trim().toLowerCase()
  if (!q) return jobs
  return jobs.filter((j) => `${j.title} ${j.employer} ${j.worker} ${j.reference} ${j.scope}`.toLowerCase().includes(q))
}

function reputation(jobs) {
  const map = new Map()
  const ensure = (name, role) => {
    if (!name) return null
    if (!map.has(name)) map.set(name, { name, roles: new Set(), posted: 0, worked: 0, released: 0, disputes: 0, earned: 0, spent: 0 })
    const r = map.get(name); r.roles.add(role); return r
  }
  for (const job of jobs) {
    const emp = ensure(job.employer, 'employer')
    const wrk = job.worker ? ensure(job.worker, 'worker') : null
    if (emp) { emp.posted++; if (job.status === 'released') emp.spent += Number(job.amountSol || 0); if (job.disputes?.length) emp.disputes++ }
    if (wrk) { wrk.worked++; if (job.status === 'released') { wrk.released++; wrk.earned += Number(job.amountSol || 0) } if (job.disputes?.length) wrk.disputes++ }
  }
  return [...map.values()].map((r) => {
    const score = Math.max(8, Math.min(99, Math.round(62 + r.released * 9 - r.disputes * 16 + Math.min(r.worked, 5) * 2)))
    return { ...r, score, stars: Math.max(1, Math.round(score / 20)) }
  }).sort((a, b) => b.score - a.score)
}

/* ---------------- icons ---------------- */
const PATHS = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  chart: 'M3 3v18h18M7 14v4M12 9v9M17 5v13',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3zM3 7V5a2 2 0 0 1 2-2h11v4M17 13h.01',
  star: 'M12 2l3 7 7 .5-5.3 4.6L18 21l-6-3.6L6 21l1.3-6.9L2 9.5 9 9z',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z',
  plus: 'M12 5v14M5 12h14',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
  sparkles: 'M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6zM19 15l.6 1.9L21.5 17.5l-1.9.6L19 20l-.6-1.9L16.5 17.5l1.9-.6z',
  bolt: 'M13 2L3 14h7l-1 8 10-12h-7z',
  menu: 'M3 6h18M3 12h18M3 18h18',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  chevron: 'M6 9l6 6 6-6',
}
function Icon({ name, className = 'ico' }) {
  return html`<svg class=${className} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d=${PATHS[name] || ''} /></svg>`
}

/* ---------------- primitives ---------------- */
const Badge = ({ status }) => html`<span class=${`badge ${status || ''}`}>${statusText(status)}</span>`
const Avatar = ({ name }) => html`<span class="avatar">${initials(name)}</span>`
const Field = ({ label, children }) => html`<label class="field"><span>${label}</span>${children}</label>`

function Empty({ title, body, icon = 'inbox', action }) {
  return html`<div class="empty"><${Icon} name=${icon} className="ico" /><b>${title}</b><p>${body}</p>${action}</div>`
}

function Copy({ value }) {
  const [ok, setOk] = useState(false)
  if (!value || value === '--') return html`<span class="mono">--</span>`
  return html`<span class="mono">${short(value)}</span>
    <button class=${`copy-btn ${ok ? 'ok' : ''}`} title="Copy" onClick=${async () => {
      try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1200) } catch {}
    }}><${Icon} name=${ok ? 'check' : 'copy'} className="ico" /></button>`
}

function Stepper({ job }) {
  const active = STEP_INDEX[job.status] ?? 0
  const bad = badStatuses.has(job.status)
  const done = job.status === 'released'
  return html`<div class="stepper">
    ${LIFECYCLE.map((label, i) => {
      const cls = done ? 'done' : i < active ? 'done' : i === active ? (bad ? 'bad' : 'active') : ''
      return html`<div class=${`step ${cls}`} key=${label}>
        <div class="node">${(cls === 'done') ? html`<${Icon} name="check" className="ico" style=${{ width: 13, height: 13 }} />` : i + 1}</div>
        <span class="lbl">${label}</span>
      </div>`
    })}
  </div>`
}

function ScoreRing({ score = 0, recommendation = 'revision' }) {
  const r = 54, c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score))
  const color = recommendation === 'approve' ? 'var(--green)' : recommendation === 'dispute' ? 'var(--red)' : 'var(--amber)'
  return html`<div class="ring">
    <svg width="128" height="128">
      <circle class="track" cx="64" cy="64" r=${r} fill="none" stroke-width="11" />
      <circle class="bar" cx="64" cy="64" r=${r} fill="none" stroke=${color} stroke-width="11"
        stroke-dasharray=${c} stroke-dashoffset=${c * (1 - pct / 100)} />
    </svg>
    <div class="mid"><b>${Math.round(pct)}</b><span>/ 100</span></div>
  </div>`
}

function TrustBar({ rep }) {
  if (!rep) return null
  return html`<div class="trust">
    <div class="bar"><i style=${{ width: `${rep.score}%` }} /></div>
    <b>${rep.score}</b>
    <span class="stars">${'★'.repeat(rep.stars)}${'☆'.repeat(5 - rep.stars)}</span>
  </div>`
}

/* ---------------- login ---------------- */
function accountDraft(a) {
  return { accountId: a.id || 'custom', name: a.name || '', email: a.email || '', organization: a.organization || '', role: a.role || 'employer' }
}
function Login({ onLogin }) {
  const [accounts, setAccounts] = useState(DEFAULT_ACCOUNTS)
  const [form, setForm] = useState(() => accountDraft(DEFAULT_ACCOUNTS[0]))
  const set = (k) => (e) => setForm({ ...form, accountId: 'custom', [k]: e.target.value })
  useEffect(() => { let on = true; loadAccounts().then((n) => on && setAccounts(n)); return () => { on = false } }, [])
  const submit = (e) => {
    e.preventDefault()
    const next = {
      ...form,
      name: form.name.trim() || 'Ava Hart',
      email: form.email.trim() || 'ava@northstar.test',
      organization: form.organization.trim() || 'Northstar Studio',
      signedInAt: new Date().toISOString(),
    }
    saveSession(next)
    onLogin(next)
  }
  return html`<main class="login">
    <section class="login-hero">
      <div class="mark">FE</div>
      <div>
        <p class="kicker">Solana escrow · AI settlement</p>
        <h1>Freelance work that pays out on proof, not promises.</h1>
      </div>
      <p class="lede">Employers fund an escrow, workers deliver evidence, and an AI review agent scores the work before a single lamport moves. Disputes and refunds stay one click away.</p>
      <div class="hero-flow">
        <span>Fund</span><${Icon} name="external" className="arr ico" style=${{ width: 15 }} />
        <span>Deliver</span><${Icon} name="external" className="arr ico" style=${{ width: 15 }} />
        <span>AI review</span><${Icon} name="external" className="arr ico" style=${{ width: 15 }} />
        <span>Release</span>
      </div>
      <div class="hero-ledger">
        <div><span>Open tasks</span><b>24</b></div>
        <div><span>In review</span><b>4</b></div>
        <div><span>Settled</span><b>92%</b></div>
      </div>
    </section>
    <section class="login-panel">
      <form class="login-form" onSubmit=${submit}>
        <div><p class="kicker">Sign in</p><h2 style=${{ fontSize: '22px' }}>Open your escrow workspace</h2></div>
        <div class="accts">
          ${accounts.map((a) => html`<button key=${a.id} type="button" class=${`acct-card ${form.accountId === a.id ? 'on' : ''}`} onClick=${() => setForm(accountDraft(a))}>
            <${Avatar} name=${a.name} />
            <span class="who"><b>${a.organization}</b><small>${a.name}</small></span>
            <span class=${`role ${a.role}`}>${a.role}</span>
          </button>`)}
        </div>
        <div class="divider">or use your own</div>
        <${Field} label="Full name"><input value=${form.name} onInput=${set('name')} autocomplete="name" /><//>
        <${Field} label="Email"><input type="email" value=${form.email} onInput=${set('email')} autocomplete="email" /><//>
        <${Field} label="Organization"><input value=${form.organization} onInput=${set('organization')} /><//>
        <div class="role-picker">
          ${['employer', 'worker'].map((role) => html`<button key=${role} type="button" class=${form.role === role ? 'on' : ''} onClick=${() => setForm({ ...form, accountId: 'custom', role })}>${role}</button>`)}
        </div>
        <button class="btn primary block">Continue</button>
        <a href="./legacy.html" style=${{ textAlign: 'center', fontSize: '12.5px' }}>Open the legacy demo</a>
      </form>
    </section>
  </main>`
}

/* ---------------- shell ---------------- */
function Sidebar({ view, setView, data, session, open }) {
  const c = data.summary || {}
  const counts = { review: c.inReview, marketplace: c.openJobs, messages: 0 }
  return html`<aside class=${`sidebar ${open ? 'open' : ''}`}>
    <div class="brand"><div class="mark">FE</div><div><b>Escrow Platform</b><span>Solana · local demo</span></div></div>
    <div class="side-cta"><button class="btn primary block" onClick=${() => setView('marketplace')}>
      <${Icon} name=${session.role === 'worker' ? 'search' : 'plus'} /> ${session.role === 'worker' ? 'Find work' : 'Post a task'}
    </button></div>
    <nav class="nav">
      ${NAV.map(([id, label, icon]) => html`<button key=${id} class=${view === id ? 'on' : ''} onClick=${() => setView(id)}>
        <${Icon} name=${icon} /><span class="grow">${label}</span>
        ${counts[id] ? html`<span class="count-pill">${counts[id]}</span>` : null}
      </button>`)}
    </nav>
    <div class="side-foot">
      <div class="side-card"><span>Signed in as</span><b>${session.organization}</b><small>${session.role}</small></div>
    </div>
  </aside>`
}

function Topbar({ session, refresh, busy, onLogout, query, setQuery, toggleSidebar, searchRef, theme, toggleTheme }) {
  const [menu, setMenu] = useState(false)
  const menuRef = useRef(null)
  useEffect(() => {
    if (!menu) return
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false) }
    const onEsc = (e) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc) }
  }, [menu])
  return html`<header class="topbar">
    <button class="btn ghost sm menu-btn" onClick=${toggleSidebar}><${Icon} name="menu" /></button>
    <div class="search">
      <${Icon} name="search" className="ico" />
      <input ref=${searchRef} value=${query} onInput=${(e) => setQuery(e.target.value)} placeholder="Search tasks, clients, references" />
      <kbd>/</kbd>
    </div>
    <div class="spacer"></div>
    <div class="acct-menu" ref=${menuRef}>
      <button class=${`acct-trigger ${menu ? 'on' : ''}`} onClick=${() => setMenu((m) => !m)}>
        <${Avatar} name=${session.name} />
        <div class="who"><b>${session.name}</b><span>${session.email}</span></div>
        <${Icon} name="chevron" className="ico chev" />
      </button>
      ${menu ? html`<div class="menu">
        <div class="menu-head">
          <${Avatar} name=${session.name} />
          <div><b>${session.name}</b><span>${session.email}</span><small>${session.organization} · ${session.role}</small></div>
        </div>
        <button class="menu-item" disabled=${busy} onClick=${() => { refresh() }}><${Icon} name="refresh" className=${busy ? 'ico spin' : 'ico'} /> Refresh data</button>
        <button class="menu-item" onClick=${() => toggleTheme()}><${Icon} name=${theme === 'dark' ? 'sun' : 'moon'} /> ${theme === 'dark' ? 'Light appearance' : 'Dark appearance'}</button>
        <div class="menu-sep"></div>
        <button class="menu-item danger" onClick=${() => { setMenu(false); onLogout() }}><${Icon} name="logout" /> Sign out</button>
      </div>` : null}
    </div>
  </header>`
}

const Stat = ({ label, value, sub, accent }) => html`<div class="stat" style=${{ '--accent': accent }}>
  <span class="lbl"><span class="dot"></span>${label}</span><b class="val">${value}</b>${sub ? html`<span class="sub">${sub}</span>` : null}
</div>`

/* ---------------- task list ---------------- */
function TaskTable({ jobs, selectedId, setSelectedId, emptyTitle = 'No tasks yet', emptyBody = 'Post a task or claim open work to start.' }) {
  if (!jobs.length) return html`<${Empty} title=${emptyTitle} body=${emptyBody} />`
  return html`<div class="table">
    <div class="table-head"><span>Task</span><span>Client / worker</span><span>Budget</span><span>Status</span><span>Next step</span></div>
    ${jobs.map((job) => html`<button key=${job.id} class=${`row ${selectedId === job.id ? 'on' : ''}`} onClick=${() => setSelectedId(job.id)}>
      <span class="t-title"><b>${job.title}</b><small class="mono">${short(job.reference)}</small></span>
      <span class="t-party">${party(job.employer)}<small>${isOpen(job) ? 'Awaiting worker' : party(job.worker)}</small></span>
      <span class="t-amount"><b>${money(job.amountSol)}</b><small>${job.settlement.mode}</small></span>
      <span class="t-status"><${Badge} status=${job.status} /></span>
      <span class="t-next">${nextAction(job)}</span>
    </button>`)}
  </div>`
}

function sectionsFor(jobs, session) {
  const org = session?.organization
  const open = jobs.filter((j) => j.status === 'open')
  const review = jobs.filter((j) => j.status === 'submitted' || j.status === 'revision_requested')
  const completed = jobs.filter((j) => terminal.has(j.status))
  if (session?.role === 'worker') {
    return [
      ['Open tasks', 'Available work you can claim', open],
      ['My claimed work', 'Active tasks assigned to you', jobs.filter((j) => j.worker === org && j.status !== 'open' && !terminal.has(j.status))],
      ['In review', 'Submitted or revision-requested', review],
      ['Completed', 'Released, refunded, or cancelled', completed],
    ]
  }
  return [
    ['My posted tasks', 'Tasks from your organization', jobs.filter((j) => j.employer === org)],
    ['Open marketplace', 'Tasks waiting for workers', open.filter((j) => j.employer !== org)],
    ['In review', 'Submitted or revision-requested', review],
    ['Completed', 'Released, refunded, or cancelled', completed],
  ]
}

function TaskSections({ jobs, selectedId, setSelectedId, session }) {
  return html`<div class="list-stack">
    ${sectionsFor(jobs, session).map(([title, sub, list]) => html`<section class="list-section" key=${title}>
      <div class="section-head"><div><h3>${title}</h3><span class="sub">${sub}</span></div><span class="count-pill" style=${{ background: 'var(--panel-2)', color: 'var(--muted)' }}>${list.length}</span></div>
      <${TaskTable} jobs=${list} selectedId=${selectedId} setSelectedId=${setSelectedId} emptyTitle=${`No ${title.toLowerCase()}`} emptyBody="Nothing here yet." />
    </section>`)}
  </div>`
}

/* ---------------- detail panel ---------------- */
function DetailPanel({ job, session, act, reps }) {
  const [tab, setTab] = useState('details')
  if (!job) return html`<${Empty} title="Select a task" body="Terms, escrow state, milestones, and activity show up here." icon="box" />`
  const done = job.milestones.filter((m) => m.status === 'complete').length
  const pct = job.milestones.length ? Math.round((done / job.milestones.length) * 100) : 0
  const counterName = session?.role === 'worker' ? job.employer : job.worker
  const counterRep = reps?.find((r) => r.name === counterName)
  return html`<aside class="detail">
    <div class="panel">
      <div class="detail-head">
        <div><h2>${job.title}</h2><div class="who">${isOpen(job) ? 'Awaiting a worker' : `${party(job.employer)} → ${party(job.worker)}`}</div></div>
        <${Badge} status=${job.status} />
      </div>
      <div style=${{ margin: '16px 0' }}><${Stepper} job=${job} /></div>
      ${canClaim(job, session) && act ? html`<button class="btn primary block" style=${{ marginBottom: '14px' }} onClick=${() => act(() => api(`/api/jobs/${job.id}/claim`, { worker: session.organization, name: session.name }), 'Task claimed')}>Claim this task</button>` : null}
      <div style=${{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
        <button class=${`chip ${tab === 'details' ? 'on' : ''}`} onClick=${() => setTab('details')}>Details</button>
        <button class=${`chip ${tab === 'activity' ? 'on' : ''}`} onClick=${() => setTab('activity')}>Activity <span class="count">${job.events?.length || 0}</span></button>
      </div>
      ${tab === 'details' ? html`
        <dl class="dl">
          <div><dt>Reference</dt><dd><${Copy} value=${job.reference} /></dd></div>
          <div><dt>Escrow</dt><dd><${Copy} value=${job.settlement.escrow} /></dd></div>
          <div><dt>Amount</dt><dd>${money(job.amountSol)}</dd></div>
          <div><dt>Milestones</dt><dd>${done}/${job.milestones.length}</dd></div>
        </dl>
        <div style=${{ margin: '12px 0' }}><div class="progress"><i style=${{ width: `${pct}%` }} /></div></div>
        <div class="terms">
          <b>Scope</b><p>${job.scope || job.requirements}</p>
          <b>Acceptance criteria</b><p style=${{ marginBottom: 0 }}>${job.acceptanceCriteria}</p>
        </div>
        <div class="section-head" style=${{ margin: '16px 0 8px' }}><h3>Milestones</h3><span class="sub">${done}/${job.milestones.length}</span></div>
        <div class="mini-list">
          ${job.milestones.map((m) => html`<p key=${m.id} class=${m.status}>
            <span>${m.status === 'complete' ? html`<span class="tick">✓ </span>` : ''}${m.title}</span><b>${money(m.amountSol)}</b>
          </p>`)}
        </div>
        ${counterName && counterRep ? html`<div style=${{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--line-soft)' }}>
          <div class="section-head" style=${{ marginBottom: '8px' }}><h3>Counterparty trust</h3><span class="sub">${party(counterName)}</span></div>
          <${TrustBar} rep=${counterRep} />
        </div>` : null}
      ` : html`<div class="timeline">
        ${(job.events || []).length ? job.events.map((e, i) => html`<div class=${`ev ${e.type}`} key=${i}>
          <b>${statusText(e.type)} · ${e.actor}</b><span>${e.summary}</span><time>${when(e.at)}</time>
        </div>`) : html`<${Empty} title="No activity yet" body="Actions on this task will appear here." icon="chat" />`}
      </div>`}
    </div>
  </aside>`
}

/* ---------------- marketplace + post ---------------- */
function PostTask({ session, createTask }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    employer: session.organization,
    title: 'Build checkout conversion section',
    scope: 'Responsive checkout section with pricing, accessible buttons, mobile proof, and deployment notes.',
    acceptanceCriteria: 'Includes preview URL, repo link, mobile screenshot evidence, pricing copy, and notes for each acceptance item.',
    milestones: 'Wireframe and copy\nResponsive implementation\nPreview URL and handoff notes',
    amountSol: 0.001,
  })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  if (!open) return html`<div class="card" style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
    <div><b style=${{ fontSize: '15px' }}>Post an open task</b><p class="muted" style=${{ margin: '4px 0 0', fontSize: '13px' }}>Set scope, milestones, and budget. Workers claim it from the marketplace.</p></div>
    <button class="btn primary" onClick=${() => setOpen(true)}><${Icon} name="plus" /> New task</button>
  </div>`
  return html`<form class="card" onSubmit=${(e) => { e.preventDefault(); createTask({ ...form, marketplace: true, amountSol: Number(form.amountSol) || 0.001 }); setOpen(false) }}>
    <div class="section-head"><h2>Post a task</h2><button type="button" class="btn ghost sm" onClick=${() => setOpen(false)}><${Icon} name="x" /></button></div>
    <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '12px', marginBottom: '12px' }}>
      <${Field} label="Employer"><input value=${form.employer} onInput=${set('employer')} /><//>
      <${Field} label="Title"><input value=${form.title} onInput=${set('title')} /><//>
      <${Field} label="Budget (SOL)"><input type="number" min="0.001" step="0.001" value=${form.amountSol} onInput=${set('amountSol')} /><//>
    </div>
    <div style=${{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <${Field} label="Scope"><textarea value=${form.scope} onInput=${set('scope')} /><//>
      <${Field} label="Acceptance criteria"><textarea value=${form.acceptanceCriteria} onInput=${set('acceptanceCriteria')} /><//>
      <${Field} label="Milestones (one per line)"><textarea value=${form.milestones} onInput=${set('milestones')} /><//>
    </div>
    <button class="btn primary" style=${{ marginTop: '14px' }}><${Icon} name="bolt" /> Fund and post</button>
  </form>`
}

function Marketplace({ data, selected, selectedId, setSelectedId, session, createTask, act, reps }) {
  const s = data.summary || {}
  const heading = session.role === 'worker' ? 'Find work' : 'Task marketplace'
  return html`<div class="view">
    <div class="page-head">
      <div><p class="kicker">${session.role} workspace</p><h1>${heading}</h1></div>
      <div class="page-metrics">
        <span><b>${s.openJobs ?? 0}</b> open</span><span><b>${s.claimedJobs ?? 0}</b> active</span>
        <span><b>${s.inReview ?? 0}</b> in review</span><span><b>${money(s.lockedSol)}</b> in escrow</span>
      </div>
    </div>
    ${session.role === 'employer' ? html`<${PostTask} session=${session} createTask=${createTask} />` : null}
    <div class="workspace">
      <section class="panel"><div class="section-head"><h2>${heading}</h2><span class="sub">${data.jobs.length} records</span></div>
        <${TaskSections} jobs=${data.jobs} selectedId=${selectedId} setSelectedId=${setSelectedId} session=${session} /></section>
      <${DetailPanel} job=${selected} session=${session} act=${act} reps=${reps} />
    </div>
  </div>`
}

/* ---------------- dashboard ---------------- */
function Dashboard({ data, selected, selectedId, setSelectedId, session, act, reps }) {
  const jobs = data.jobs || []
  const s = data.summary || {}
  const bal = data.setup?.wallets?.balances || {}
  const settleRate = s.totalJobs ? Math.round((s.releasedJobs / s.totalJobs) * 100) : 0
  return html`<div class="view">
    <div class="page-head"><div><p class="kicker">Overview</p><h1>Dashboard</h1></div></div>
    <div class="stats">
      <${Stat} label="Open tasks" value=${s.openJobs ?? 0} sub=${`${s.totalJobs ?? jobs.length} total`} accent="var(--green-soft)" />
      <${Stat} label="In escrow" value=${money(s.lockedSol)} sub="locked in active jobs" accent="var(--blue-soft)" />
      <${Stat} label="Needs review" value=${s.inReview ?? 0} sub="submitted evidence" accent="var(--amber-soft)" />
      <${Stat} label="Settlement rate" value=${`${settleRate}%`} sub=${`${s.releasedJobs ?? 0} released · ${s.disputedJobs ?? 0} disputed`} accent="var(--green-soft)" />
    </div>
    ${reps?.length ? html`<section class="panel"><div class="section-head"><div><h2>Reputation</h2><span class="sub">Trust derived from on-platform activity</span></div></div>
      <div class="rep-grid">${reps.slice(0, 4).map((r) => html`<${RepCard} rep=${r} key=${r.name} />`)}</div></section>` : null}
    <div class="workspace">
      <section class="panel"><div class="section-head"><h2>Marketplace overview</h2><span class="sub">${jobs.length} records</span></div>
        <${TaskSections} jobs=${jobs} selectedId=${selectedId} setSelectedId=${setSelectedId} session=${session} /></section>
      <${DetailPanel} job=${selected} session=${session} act=${act} reps=${reps} />
    </div>
  </div>`
}

/* ---------------- messages ---------------- */
function Messages({ job, act, session }) {
  const [text, setText] = useState('')
  if (!job) return html`<div class="view"><${Empty} title="No task selected" body="Pick a claimed task to open its thread." icon="chat" /></div>`
  if (isOpen(job)) return html`<div class="view"><div class="workspace">
    <${Empty} title="Task not claimed yet" body="Messaging opens once a worker claims the task." icon="chat" />
    <${DetailPanel} job=${job} session=${session} /></div></div>`
  const author = session.role === 'worker' ? 'worker' : 'employer'
  return html`<div class="view"><div class="workspace">
    <section class="panel">
      <div class="section-head"><h2>Messages</h2><span class="sub">${job.messages.length} in thread</span></div>
      <div class="thread">
        ${job.messages.map((m, i) => html`<div key=${i} class=${`msg ${m.author}`}><div class="who">${m.author}</div><p>${m.text}</p><time>${when(m.at)}</time></div>`)}
        ${!job.messages.length ? html`<p class="muted" style=${{ textAlign: 'center', padding: '20px' }}>No messages yet. Say hello.</p>` : null}
      </div>
      <div class="compose">
        <input value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${`Message as ${author}`}
          onKeyDown=${(e) => { if (e.key === 'Enter' && text.trim()) { act(async () => { await api(`/api/jobs/${job.id}/messages`, { author, text }); setText('') }) } }} />
        <button class="btn primary" disabled=${!text.trim()} onClick=${() => act(async () => { await api(`/api/jobs/${job.id}/messages`, { author, text }); setText('') })}>Send</button>
      </div>
    </section>
    <${DetailPanel} job=${job} session=${session} />
  </div></div>`
}

/* ---------------- delivery ---------------- */
function Delivery({ job, act, session }) {
  const [sub, setSub] = useState({ url: '', repo: '', notes: '' })
  const set = (k) => (e) => setSub({ ...sub, [k]: e.target.value })
  if (!job) return html`<div class="view"><${Empty} title="No delivery selected" body="Select claimed work to submit evidence." icon="box" /></div>`
  if (isOpen(job)) return html`<div class="view"><div class="workspace">
    <${Empty} title="No worker yet" body="A worker must claim this task before delivery begins." icon="box" />
    <${DetailPanel} job=${job} session=${session} /></div></div>`
  return html`<div class="view"><div class="workspace">
    <section class="panel">
      <div class="section-head"><h2>Delivery room</h2><${Badge} status=${job.status} /></div>
      <div class="ms-board">
        ${job.milestones.map((m) => html`<div key=${m.id} class=${`ms-card ${m.status}`}>
          <div><b>${m.title}</b><div class="amt">${money(m.amountSol)}</div></div>
          <button class="btn ghost sm" disabled=${!canWork(job) || m.status === 'complete'} onClick=${() => act(() => api(`/api/jobs/${job.id}/milestones/${m.id}/complete`, { actor: 'worker' }), 'Milestone marked done')}>
            ${m.status === 'complete' ? '✓ Done' : 'Mark done'}
          </button>
        </div>`)}
      </div>
      <form class="submit-form" onSubmit=${(e) => { e.preventDefault(); act(() => api(`/api/jobs/${job.id}/submission`, sub), 'Evidence submitted for review') }}>
        <div class="section-head" style=${{ marginBottom: 0 }}><h3>Submit delivery evidence</h3></div>
        <${Field} label="Preview URL"><input value=${sub.url} onInput=${set('url')} placeholder="https://..." /><//>
        <${Field} label="Repository"><input value=${sub.repo} onInput=${set('repo')} placeholder="https://github.com/..." /><//>
        <${Field} label="Delivery notes"><textarea value=${sub.notes} onInput=${set('notes')} placeholder="Explain what each acceptance item is proven by." /><//>
        <button class="btn primary" disabled=${!canWork(job)}><${Icon} name="box" /> Submit for review</button>
      </form>
    </section>
    <${DetailPanel} job=${job} session=${session} />
  </div></div>`
}

/* ---------------- review ---------------- */
function ReviewReport({ review }) {
  const rec = review.recommendation || (review.approved ? 'approve' : 'revision')
  const src = review.source === 'ai' ? 'AI review agent' : review.source === 'fallback' ? 'Review unavailable' : 'Heuristic review'
  const checks = review.checks || [], missing = review.missing || [], risks = review.risks || []
  return html`<div class="review-wrap">
    <${ScoreRing} score=${review.score ?? 0} recommendation=${rec} />
    <div class="review-body">
      <div class="head-row">
        <span class=${`rec-pill ${rec}`}>${statusText(rec)}</span>
        <span class="review-src">${src}</span>
      </div>
      <p class="review-summary">${review.summary}</p>
      ${checks.length ? html`<div class="checks">${checks.map((c, i) => html`<div class=${`check ${c.status}`} key=${i}>
        <span class="mk">${c.status === 'pass' ? '✓' : c.status === 'fail' ? '✕' : '?'}</span>
        <div><b>${c.label}</b><p>${c.reason || c.evidence || 'No detail provided.'}</p></div>
        <span class="st">${c.status}</span>
      </div>`)}</div>` : null}
      ${missing.length ? html`<div><div class="review-src" style=${{ marginBottom: '5px', fontWeight: 640 }}>Missing evidence</div><div class="tag-row">${missing.map((m, i) => html`<span class="tag" key=${i}>${m}</span>`)}</div></div>` : null}
      ${risks.length ? html`<div><div class="review-src" style=${{ marginBottom: '5px', fontWeight: 640 }}>Risks</div><div class="tag-row">${risks.map((r, i) => html`<span class="tag warn" key=${i}>${r}</span>`)}</div></div>` : null}
    </div>
  </div>`
}

function Review({ job, act, session }) {
  if (!job) return html`<div class="view"><${Empty} title="No review selected" body="Select submitted work to review its evidence." icon="shield" /></div>`
  if (isOpen(job)) return html`<div class="view"><div class="workspace">
    <${Empty} title="Nothing to review" body="Open tasks can't be reviewed until a worker claims and submits work." icon="shield" />
    <${DetailPanel} job=${job} session=${session} /></div></div>`
  const canReview = Boolean(job.submission) && !isTerminal(job) && job.status !== 'disputed'
  const rec = job.review?.recommendation
  const canRelease = canReview && rec === 'approve'
  const canOverride = canReview && job.review && rec !== 'approve'
  const note = (job.review?.missing || []).join('; ') || 'Please address the review notes and resubmit evidence.'
  return html`<div class="view"><div class="workspace">
    <section class="panel">
      <div class="section-head"><h2>Review desk</h2><${Badge} status=${job.status} /></div>
      <div class="evidence">
        <div class="ev-row"><span>Preview</span>${job.submission?.url ? html`<a href=${job.submission.url} target="_blank" rel="noreferrer">${job.submission.url}</a>` : html`<span class="missing">Missing</span>`}</div>
        <div class="ev-row"><span>Repository</span>${job.submission?.repo ? html`<a href=${job.submission.repo} target="_blank" rel="noreferrer">${job.submission.repo}</a>` : html`<span class="missing">Missing</span>`}</div>
        <div class="ev-notes">${job.submission?.notes || 'No worker evidence submitted yet.'}</div>
      </div>
      ${job.review ? html`<${ReviewReport} review=${job.review} />` : html`<div class="empty" style=${{ padding: '26px' }}><${Icon} name="sparkles" className="ico" /><b>No review run yet</b><p>Run the AI agent to score the delivery against the acceptance criteria.</p></div>`}
      <div class="action-bar">
        <button class="btn primary" disabled=${!canReview} onClick=${() => act(() => api(`/api/jobs/${job.id}/review`, { action: 'assess' }), 'AI review complete')}><${Icon} name="sparkles" /> Run AI review</button>
        <button class="btn ghost" disabled=${!canReview} onClick=${() => act(() => api(`/api/jobs/${job.id}/review`, {}), 'Heuristic review settled')} title="Deterministic keyword review — works offline and settles instantly">Quick heuristic settle</button>
        <button class="btn success" disabled=${!canRelease} onClick=${() => act(() => api(`/api/jobs/${job.id}/review`, { action: 'approve' }), 'Escrow released to worker')}><${Icon} name="check" /> Approve & release</button>
        <button class="btn ghost" disabled=${!canReview || !job.review} onClick=${() => act(() => api(`/api/jobs/${job.id}/review`, { action: 'request_revision', note }), 'Revision requested')}>Request revision</button>
        ${canOverride ? html`<button class="btn danger" onClick=${() => act(() => api(`/api/jobs/${job.id}/review`, { action: 'approve', override: true }), 'Released with override')}>Release anyway</button>` : null}
        <button class="btn danger" disabled=${isTerminal(job) || isOpen(job)} onClick=${() => act(() => api(`/api/jobs/${job.id}/dispute`, { by: session.role === 'worker' ? 'worker' : 'employer', note: 'Needs manual review before settlement.' }), 'Dispute opened')}>Open dispute</button>
      </div>
    </section>
    <${DetailPanel} job=${job} session=${session} />
  </div></div>`
}

/* ---------------- payments ---------------- */
function Payments({ job, data, act, session }) {
  const ledger = job?.settlement?.events || []
  return html`<div class="view"><div class="workspace">
    <section class="panel">
      <div class="section-head"><h2>Payments</h2><span class="sub">${data.setup?.mode}</span></div>
      ${job ? html`
        <dl class="dl wide">
          <div><dt>Status</dt><dd>${statusText(job.status)}</dd></div>
          <div><dt>Escrow account</dt><dd><${Copy} value=${job.settlement.escrow} /></dd></div>
          <div><dt>Release ref</dt><dd>${job.settlement.release ? html`<${Copy} value=${job.settlement.release} />` : '--'}</dd></div>
          <div><dt>Refund ref</dt><dd>${job.settlement.refund ? html`<${Copy} value=${job.settlement.refund} />` : '--'}</dd></div>
        </dl>
        <div class="action-bar" style=${{ margin: '14px 0' }}>
          <button class="btn danger" disabled=${isTerminal(job) || isOpen(job)} onClick=${() => act(() => api(`/api/jobs/${job.id}/refund`, {}), 'Escrow refunded to employer')}>Refund employer</button>
          <button class="btn ghost" disabled=${isTerminal(job) || job.submission} onClick=${() => act(() => api(`/api/jobs/${job.id}/cancel`, {}), 'Job cancelled')}>Cancel job</button>
        </div>
        <div class="section-head" style=${{ margin: '4px 0 10px' }}><h3>Settlement ledger</h3></div>
        <div class="ledger">
          ${ledger.map((e, i) => html`<p key=${i} class=${e.type}><b>${statusText(e.type)}</b><span>${e.summary}</span><time>${when(e.at)}</time></p>`)}
          ${!ledger.length ? html`<p class="muted">No settlement events yet.</p>` : null}
        </div>
      ` : html`<${Empty} title="No payment selected" body="Select a task to inspect escrow movement." icon="wallet" />`}
    </section>
    <${DetailPanel} job=${job} session=${session} />
  </div></div>`
}

/* ---------------- reputation ---------------- */
function RepCard({ rep }) {
  return html`<div class="rep-card">
    <div class="top"><${Avatar} name=${rep.name} /><div><b>${party(rep.name)}</b><br /><small>${[...rep.roles].join(' · ')}</small></div></div>
    <${TrustBar} rep=${rep} />
    <div class="rep-stats">
      <div><b>${rep.released}</b><span>completed</span></div>
      <div><b>${rep.disputes}</b><span>disputes</span></div>
      <div><b>${(rep.earned || rep.spent).toFixed(3)}</b><span>${rep.earned >= rep.spent ? 'earned' : 'spent'}</span></div>
    </div>
  </div>`
}
function Reputation({ reps }) {
  return html`<div class="view">
    <div class="page-head"><div><p class="kicker">Trust graph</p><h1>Reputation</h1></div>
      <div class="page-metrics"><span><b>${reps.length}</b> participants</span></div></div>
    <section class="panel">
      <div class="section-head"><div><h2>Participants</h2><span class="sub">Scores derived from completed jobs and disputes on this platform</span></div></div>
      ${reps.length ? html`<div class="rep-grid">${reps.map((r) => html`<${RepCard} rep=${r} key=${r.name} />`)}</div>`
        : html`<${Empty} title="No participants yet" body="Post and settle a task to build reputation." icon="star" />`}
    </section>
  </div>`
}

/* ---------------- settings ---------------- */
function Settings({ data, act, refresh }) {
  const [diag, setDiag] = useState(null)
  const [importText, setImportText] = useState('')
  return html`<div class="view">
    <div class="page-head"><div><p class="kicker">Workspace</p><h1>Settings</h1></div></div>
    <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' }}>
      <section class="panel">
        <div class="section-head"><h2>Demo controls</h2><span class="sub">${data.setup?.mode}</span></div>
        <p class="muted" style=${{ fontSize: '13px' }}>${data.setup?.note}</p>
        <div class="action-bar">
          <button class="btn primary" onClick=${() => act(() => api('/api/demo/seed', {}), 'Sample contract seeded')}><${Icon} name="bolt" /> Seed sample</button>
          <button class="btn ghost" onClick=${() => act(() => api('/api/state/reset', {}), 'Local jobs cleared')}>Reset jobs</button>
          <button class="btn ghost" onClick=${refresh}><${Icon} name="refresh" /> Reload</button>
          <button class="btn ghost" onClick=${async () => setDiag(await api('/api/health'))}>Diagnostics</button>
        </div>
        ${diag ? html`<pre class="diag">${JSON.stringify(diag, null, 2)}</pre>` : null}
      </section>
      <section class="panel">
        <div class="section-head"><h2>Import / export</h2></div>
        <p class="muted" style=${{ fontSize: '13px' }}>Back up or restore the full platform state as JSON.</p>
        <div class="action-bar" style=${{ marginBottom: '12px' }}>
          <button class="btn ghost" onClick=${async () => {
            const payload = await api('/api/export')
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
            a.download = 'freelance-escrow-export.json'; a.click(); URL.revokeObjectURL(a.href)
          }}><${Icon} name="external" /> Export JSON</button>
        </div>
        <${Field} label="Paste an export blob to import">
          <textarea value=${importText} onInput=${(e) => setImportText(e.target.value)} placeholder='{ "jobs": [...] }' />
        <//>
        <button class="btn primary" style=${{ marginTop: '10px' }} disabled=${!importText.trim()} onClick=${() => act(async () => { await api('/api/import', JSON.parse(importText)); setImportText('') }, 'State imported')}>Import JSON</button>
      </section>
    </div>
  </div>`
}

/* ---------------- toasts ---------------- */
function Toasts({ toasts }) {
  return html`<div class="toasts">${toasts.map((t) => html`<div key=${t.id} class=${`toast ${t.type}`}>
    <${Icon} name=${t.type === 'ok' ? 'check' : t.type === 'err' ? 'x' : 'bolt'} className="ico" />
    <div class="msg">${t.msg}</div>
  </div>`)}</div>`
}

/* ---------------- app ---------------- */
function App() {
  const [session, setSession] = useState(loadSession)
  const [data, setData] = useState({ jobs: [], summary: {}, setup: { wallets: {}, note: '' } })
  const [selectedId, setSelectedId] = useState('')
  const [view, setView] = useState('marketplace')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [toasts, setToasts] = useState([])
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'light')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const searchRef = useRef(null)
  const toastSeq = useRef(0)

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem(THEME_KEY, theme) }, [theme])
  useEffect(() => {
    const onKey = (e) => { if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') { e.preventDefault(); searchRef.current?.focus() } }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toast = (msg, type = 'ok') => {
    const id = ++toastSeq.current
    setToasts((t) => [...t, { id, msg, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }

  const refresh = async () => {
    const next = await api('/api/platform')
    setData(next)
    setSelectedId((cur) => next.jobs.some((j) => j.id === cur) ? cur : preferredJobId(next.jobs, session))
  }

  const act = async (fn, successMsg) => {
    setBusy(true); setError('')
    try { await fn(); await refresh(); if (successMsg) toast(successMsg, 'ok') }
    catch (e) { const m = e.message || String(e); setError(m); toast(m, 'err') }
    finally { setBusy(false) }
  }

  const createTask = async (payload) => {
    setBusy(true); setError('')
    try {
      const next = await api('/api/jobs', payload)
      setData(next); setSelectedId(next.jobs[0]?.id || ''); setView('marketplace'); toast('Task posted and funded', 'ok')
    } catch (e) { const m = e.message || String(e); setError(m); toast(m, 'err') }
    finally { setBusy(false) }
  }

  useEffect(() => { if (session) refresh().catch((e) => setError(e.message || String(e))) }, [session])

  const filtered = useMemo(() => filterJobs(data.jobs || [], query), [data.jobs, query])
  const viewData = useMemo(() => ({ ...data, jobs: filtered }), [data, filtered])
  const reps = useMemo(() => reputation(data.jobs || []), [data.jobs])
  const selected = useMemo(() => (data.jobs || []).find((j) => j.id === selectedId) || filtered[0] || data.jobs?.[0], [data.jobs, filtered, selectedId])

  if (!session) return html`<${React.Fragment}><${Login} onLogin=${(s) => { setSession(s); setView('marketplace') }} /><${Toasts} toasts=${toasts} /><//>`

  const logout = () => { localStorage.removeItem(SESSION_KEY); setSession(null) }
  const common = { data: viewData, selected, selectedId, setSelectedId, session, act, reps }
  const content =
    view === 'marketplace' ? html`<${Marketplace} ...${common} createTask=${createTask} />`
    : view === 'dashboard' ? html`<${Dashboard} ...${common} />`
    : view === 'messages' ? html`<${Messages} job=${selected} act=${act} session=${session} />`
    : view === 'delivery' ? html`<${Delivery} job=${selected} act=${act} session=${session} />`
    : view === 'review' ? html`<${Review} job=${selected} act=${act} session=${session} />`
    : view === 'payments' ? html`<${Payments} job=${selected} data=${viewData} act=${act} session=${session} />`
    : view === 'reputation' ? html`<${Reputation} reps=${reps} />`
    : html`<${Settings} data=${data} act=${act} refresh=${refresh} />`

  return html`<div class="app">
    <${Sidebar} view=${view} setView=${(v) => { setView(v); setSidebarOpen(false) }} data=${data} session=${session} open=${sidebarOpen} />
    <section class="content">
      <${Topbar} session=${session} refresh=${() => act(() => Promise.resolve())} busy=${busy} onLogout=${logout} query=${query} setQuery=${setQuery} toggleSidebar=${() => setSidebarOpen((o) => !o)} searchRef=${searchRef} theme=${theme} toggleTheme=${() => setTheme((t) => t === 'dark' ? 'light' : 'dark')} />
      ${error ? html`<div style=${{ padding: '0 26px', marginTop: '12px' }}><div class="error-bar">${error}</div></div>` : null}
      ${content}
    </section>
    <${Toasts} toasts=${toasts} />
  </div>`
}

function preferredJobId(jobs, session) {
  const org = session?.organization
  const p = session?.role === 'worker'
    ? jobs.find((j) => j.status === 'open') || jobs.find((j) => j.worker === org)
    : jobs.find((j) => j.employer === org) || jobs.find((j) => j.status === 'open')
  return p?.id || jobs[0]?.id || ''
}

createRoot(document.getElementById('root')).render(html`<${App} />`)
