import React, { useEffect, useMemo, useState } from 'https://esm.sh/react@18.3.1'
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client'
import htm from 'https://esm.sh/htm@3.1.1'

const html = htm.bind(React.createElement)
const API = window.FREELANCE_API ?? window.FREELANCE_ESCROW_API ?? 'http://localhost:8801'
const SESSION_KEY = 'freelance-escrow-session'
const ACCOUNTS_URL = './accounts.json'
const terminal = new Set(['released', 'refunded', 'cancelled'])
const DEFAULT_ACCOUNTS = [
  { id: 'northstar-employer', role: 'employer', name: 'Ava Hart', email: 'ava@northstar.test', organization: 'Northstar Studio' },
  { id: 'checkout-worker', role: 'worker', name: 'Leo Marin', email: 'leo@checkoutguild.test', organization: 'Checkout Guild' },
  { id: 'rivet-worker', role: 'worker', name: 'Mina Cole', email: 'mina@rivetworks.test', organization: 'Rivet Works' },
]
const nav = [
  ['marketplace', 'Marketplace'],
  ['dashboard', 'Dashboard'],
  ['messages', 'Messages'],
  ['delivery', 'Delivery'],
  ['review', 'Review'],
  ['payments', 'Payments'],
  ['settings', 'Settings'],
]

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

function loadSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
    return session && ['employer', 'worker'].includes(session.role) ? session : null
  } catch {
    return null
  }
}

function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

function statusText(status) {
  return String(status || 'none').replace(/_/g, ' ')
}

function money(value) {
  return `${Number(value || 0).toFixed(3)} SOL`
}

function short(value) {
  return value ? `${String(value).slice(0, 6)}...${String(value).slice(-4)}` : '--'
}

function party(value) {
  const text = String(value || '')
  return text.length > 28 && !text.includes(' ') ? short(text) : text
}

function initials(name) {
  return String(name || 'User').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'U'
}

function accountDraft(account) {
  return {
    accountId: account.id || 'custom',
    name: account.name || '',
    email: account.email || '',
    organization: account.organization || '',
    role: account.role || 'employer',
  }
}

function isTerminal(job) {
  return job && terminal.has(job.status)
}

function isOpen(job) {
  return job?.status === 'open'
}

function canClaim(job, session) {
  return isOpen(job) && session?.role === 'worker'
}

function canWork(job) {
  return job && !isOpen(job) && !isTerminal(job) && job.status !== 'disputed'
}

function preferredJobId(jobs, session) {
  const org = session?.organization
  const preferred = session?.role === 'worker'
    ? jobs.find((job) => job.status === 'open') || jobs.find((job) => job.worker === org)
    : jobs.find((job) => job.employer === org) || jobs.find((job) => job.status === 'open')
  return preferred?.id || jobs[0]?.id || ''
}

function nextAction(job) {
  if (!job) return 'Select task'
  if (job.status === 'open') return 'Waiting for worker'
  if (job.status === 'funded') return job.submission ? 'Review evidence' : 'Await delivery'
  if (job.status === 'submitted') return 'Review and settle'
  if (job.status === 'revision_requested') return 'Needs revision'
  if (job.status === 'disputed') return 'Resolve dispute'
  if (job.status === 'released') return 'Paid out'
  if (job.status === 'refunded') return 'Refunded'
  if (job.status === 'cancelled') return 'Cancelled'
  return 'Monitor'
}

function Badge({ status }) {
  return html`<span class=${`escrow-badge ${status || ''}`}>${statusText(status)}</span>`
}

function Avatar({ name }) {
  return html`<span class="escrow-avatar">${initials(name)}</span>`
}

function Field({ label, children }) {
  return html`<label class="escrow-field"><span>${label}</span>${children}</label>`
}

function Empty({ title, body, action }) {
  return html`<section class="escrow-empty">
    <b>${title}</b>
    <p>${body}</p>
    ${action}
  </section>`
}

function Login({ onLogin }) {
  const [accounts, setAccounts] = useState(DEFAULT_ACCOUNTS)
  const [form, setForm] = useState(() => accountDraft(DEFAULT_ACCOUNTS[0]))
  const set = (key) => (e) => setForm({ ...form, accountId: 'custom', [key]: e.target.value })
  const selectAccount = (account) => setForm(accountDraft(account))
  const submit = (e) => {
    e.preventDefault()
    const session = {
      ...form,
      name: form.name.trim() || 'Ava Hart',
      email: form.email.trim() || 'ava@northstar.test',
      organization: form.organization.trim() || 'Northstar Studio',
      signedInAt: new Date().toISOString(),
    }
    saveSession(session)
    onLogin(session)
  }
  useEffect(() => {
    let active = true
    loadAccounts().then((next) => { if (active) setAccounts(next) })
    return () => { active = false }
  }, [])
  return html`<main class="escrow-login">
    <section class="escrow-login-copy">
      <div class="escrow-mark">FE</div>
      <p class="escrow-kicker">Freelance Escrow Platform</p>
      <h1>Post tasks, claim work, and settle payouts in one workspace.</h1>
      <div class="escrow-login-ledger">
        <div><span>Open tasks</span><b>24</b></div>
        <div><span>In review</span><b>4</b></div>
        <div><span>Settled</span><b>92%</b></div>
      </div>
    </section>
    <form class="escrow-login-form" onSubmit=${submit}>
      <div>
        <p class="escrow-kicker">Sign in</p>
        <h2>Open your escrow workspace</h2>
      </div>
      <section class="escrow-test-accounts">
        <div class="escrow-section-head"><h3>Test accounts</h3><span>${accounts.length}</span></div>
        <div class="escrow-account-grid">
          ${accounts.map((account) => html`<button
            key=${account.id}
            type="button"
            class=${`escrow-account-card ${form.accountId === account.id ? 'on' : ''}`}
            onClick=${() => selectAccount(account)}
          >
            <span>${account.role}</span>
            <b>${account.organization}</b>
            <small>${account.name}</small>
          </button>`)}
        </div>
      </section>
      <${Field} label="Full name"><input value=${form.name} onInput=${set('name')} autocomplete="name" /></${Field}>
      <${Field} label="Email"><input type="email" value=${form.email} onInput=${set('email')} autocomplete="email" /></${Field}>
      <${Field} label="Organization"><input value=${form.organization} onInput=${set('organization')} /></${Field}>
      <div class="escrow-role-picker" role="group" aria-label="Account role">
        ${['employer', 'worker'].map((role) => html`<button
          key=${role}
          type="button"
          class=${form.role === role ? 'on' : ''}
          onClick=${() => setForm({ ...form, accountId: 'custom', role })}
        >${role}</button>`)}
      </div>
      <button class="escrow-primary">Continue</button>
      <a href="./legacy.html">Open legacy demo</a>
    </form>
  </main>`
}

function Stat({ label, value, sub }) {
  return html`<div class="escrow-stat">
    <span>${label}</span>
    <b>${value}</b>
    ${sub && html`<small>${sub}</small>`}
  </div>`
}

function Sidebar({ view, setView, data, session }) {
  const counts = data.summary || {}
  return html`<aside class="escrow-sidebar">
    <div class="escrow-brand">
      <div class="escrow-mark">FE</div>
      <div><b>Escrow Platform</b><span>Local demo</span></div>
    </div>
    <button class="escrow-new" onClick=${() => setView('marketplace')}>${session.role === 'worker' ? 'Find work' : 'Post task'}</button>
    <nav class="escrow-nav">
      ${nav.map(([id, label]) => html`<button key=${id} class=${view === id ? 'on' : ''} onClick=${() => setView(id)}>
        <span>${label}</span>
        ${id === 'review' && counts.inReview ? html`<b>${counts.inReview}</b>` : null}
        ${id === 'marketplace' && counts.openJobs ? html`<b>${counts.openJobs}</b>` : null}
      </button>`)}
    </nav>
    <div class="escrow-side-note">
      <span>Signed in as</span>
      <b>${session.organization}</b>
      <small>${session.role}</small>
    </div>
  </aside>`
}

function Topbar({ session, refresh, busy, onLogout }) {
  return html`<header class="escrow-topbar">
    <div class="escrow-search"><input placeholder="Search tasks, clients, references" /></div>
    <div class="escrow-account">
      <a href="./legacy.html">Legacy demo</a>
      <button class="escrow-ghost" disabled=${busy} onClick=${refresh}>Refresh</button>
      <${Avatar} name=${session.name} />
      <div><b>${session.name}</b><span>${session.email}</span></div>
      <button class="escrow-ghost" onClick=${onLogout}>Switch account</button>
    </div>
  </header>`
}

function TaskTable({ jobs, selectedId, setSelectedId, emptyTitle = 'No tasks yet', emptyBody = 'Post a task or claim open work to start the workflow.' }) {
  if (!jobs.length) {
    return html`<${Empty}
      title=${emptyTitle}
      body=${emptyBody}
    />`
  }
  return html`<section class="escrow-table">
    <div class="escrow-table-head">
      <span>Task</span><span>Client / worker</span><span>Budget</span><span>Status</span><span>Next step</span>
    </div>
    ${jobs.map((job) => html`<button
      key=${job.id}
      class=${`escrow-row ${selectedId === job.id ? 'on' : ''}`}
      onClick=${() => setSelectedId(job.id)}
    >
      <span><b>${job.title}</b><small>${short(job.reference)}</small></span>
      <span>${party(job.employer)}<small>${job.status === 'open' ? 'Waiting for worker' : party(job.worker)}</small></span>
      <span><b>${money(job.amountSol)}</b><small>${job.settlement.mode}</small></span>
      <span><${Badge} status=${job.status} /></span>
      <span>${nextAction(job)}</span>
    </button>`)}
  </section>`
}

function PostTask({ session, createTask }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    employer: session.role === 'worker' ? 'Client organization' : session.organization,
    title: 'Build checkout conversion section',
    scope: 'Responsive checkout section with pricing, accessible buttons, mobile proof, and deployment notes.',
    acceptanceCriteria: 'Includes preview URL, repo link, mobile screenshot evidence, pricing copy, and notes for each acceptance item.',
    milestones: 'Wireframe and copy\nResponsive implementation\nPreview URL and handoff notes',
    amountSol: 0.001,
  })
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })
  if (!open) {
    return html`<section class="escrow-create-closed">
      <div><b>Post an open task</b><span>Set scope, milestones, and budget. Workers claim it from the marketplace.</span></div>
      <button class="escrow-primary" onClick=${() => setOpen(true)}>Post task</button>
    </section>`
  }
  return html`<form class="escrow-create" onSubmit=${(e) => {
    e.preventDefault()
    createTask({ ...form, marketplace: true, amountSol: Number(form.amountSol) || 0.001 })
    setOpen(false)
  }}>
    <div class="escrow-section-head"><h2>Post task</h2><button type="button" class="escrow-ghost" onClick=${() => setOpen(false)}>Close</button></div>
    <div class="escrow-form-grid">
      <${Field} label="Employer"><input value=${form.employer} onInput=${set('employer')} /></${Field}>
      <${Field} label="Title"><input value=${form.title} onInput=${set('title')} /></${Field}>
      <${Field} label="Budget"><input type="number" min="0.001" step="0.001" value=${form.amountSol} onInput=${set('amountSol')} /></${Field}>
    </div>
    <${Field} label="Scope"><textarea value=${form.scope} onInput=${set('scope')} /></${Field}>
    <${Field} label="Acceptance criteria"><textarea value=${form.acceptanceCriteria} onInput=${set('acceptanceCriteria')} /></${Field}>
    <${Field} label="Milestones"><textarea value=${form.milestones} onInput=${set('milestones')} /></${Field}>
    <button class="escrow-primary">Post open task</button>
  </form>`
}

function DetailPanel({ job, session, act }) {
  if (!job) {
    return html`<${Empty} title="Select a task" body="Task details, terms, evidence, and escrow state show here." />`
  }
  const done = job.milestones.filter((m) => m.status === 'complete').length
  const workerLine = job.status === 'open' ? 'Waiting for worker' : `${party(job.employer)} funds ${party(job.worker)}`
  return html`<aside class="escrow-detail">
    <div class="escrow-section-head">
      <div><h2>${job.title}</h2><span>${workerLine}</span></div>
      <${Badge} status=${job.status} />
    </div>
    ${canClaim(job, session) && act ? html`<button class="escrow-primary" onClick=${() => act(() => api(`/api/jobs/${job.id}/claim`, { worker: session.organization, name: session.name }))}>Claim task</button>` : null}
    <dl class="escrow-definition">
      <div><dt>Reference</dt><dd>${job.reference}</dd></div>
      <div><dt>Escrow</dt><dd>${job.settlement.escrow}</dd></div>
      <div><dt>Amount</dt><dd>${money(job.amountSol)}</dd></div>
      <div><dt>Milestones</dt><dd>${done}/${job.milestones.length}</dd></div>
    </dl>
    <section class="escrow-terms">
      <b>Scope</b>
      <p>${job.scope || job.requirements}</p>
      <b>Acceptance</b>
      <p>${job.acceptanceCriteria}</p>
    </section>
    <section class="escrow-mini-list">
      <div class="escrow-section-head"><h3>Milestones</h3><span>${done}/${job.milestones.length}</span></div>
      ${job.milestones.map((m) => html`<p key=${m.id} class=${m.status}>
        <span>${m.title}</span>
        <b>${money(m.amountSol)}</b>
      </p>`)}
    </section>
  </aside>`
}

function taskSections(jobs, session) {
  const org = session?.organization
  const openTasks = jobs.filter((job) => job.status === 'open')
  const externalOpenTasks = openTasks.filter((job) => job.employer !== org)
  const posted = jobs.filter((job) => job.employer === org)
  const claimed = jobs.filter((job) => job.worker === org && job.status !== 'open' && !terminal.has(job.status))
  const review = jobs.filter((job) => job.status === 'submitted' || job.status === 'revision_requested')
  const completed = jobs.filter((job) => terminal.has(job.status))
  return session?.role === 'worker'
    ? [
      ['Open tasks', 'Available work workers can claim', openTasks],
      ['My claimed work', 'Active tasks assigned to you', claimed],
      ['In review', 'Submitted or revision-requested work', review],
      ['Completed', 'Released, refunded, or cancelled tasks', completed],
    ]
    : [
      ['My posted tasks', 'Tasks posted by your organization', posted],
      ['Open tasks', 'Marketplace tasks waiting for workers', externalOpenTasks],
      ['In review', 'Submitted or revision-requested work', review],
      ['Completed', 'Released, refunded, or cancelled tasks', completed],
    ]
}

function TaskSections({ jobs, selectedId, setSelectedId, session }) {
  return html`<div class="escrow-section-stack">
    ${taskSections(jobs, session).map(([title, subtitle, sectionJobs]) => html`<section class="escrow-list-section" key=${title}>
      <div class="escrow-section-head"><div><h3>${title}</h3><span>${subtitle}</span></div><span>${sectionJobs.length}</span></div>
      <${TaskTable} jobs=${sectionJobs} selectedId=${selectedId} setSelectedId=${setSelectedId} emptyTitle=${`No ${title.toLowerCase()}`} emptyBody="Nothing matches this section yet." />
    </section>`)}
  </div>`
}

function Dashboard({ data, selected, selectedId, setSelectedId, session, act }) {
  const jobs = data.jobs || []
  const summary = data.summary || {}
  const balances = data.setup?.wallets?.balances || {}
  return html`<div class="escrow-view">
    <section class="escrow-stats">
      <${Stat} label="Open tasks" value=${summary.openJobs ?? 0} sub=${`${summary.totalJobs ?? jobs.length} total`} />
      <${Stat} label="Active contracts" value=${summary.claimedJobs ?? 0} sub="claimed work" />
      <${Stat} label="Needs review" value=${summary.inReview ?? 0} sub="submitted evidence" />
      <${Stat} label="Employer balance" value=${money(balances.employerSol)} sub=${short(data.setup?.wallets?.employer)} />
    </section>
    <div class="escrow-workspace-grid">
      <section class="escrow-main-panel">
        <div class="escrow-section-head"><h2>Marketplace overview</h2><span>${jobs.length} records</span></div>
        <${TaskSections} jobs=${jobs} selectedId=${selectedId} setSelectedId=${setSelectedId} session=${session} />
      </section>
      <${DetailPanel} job=${selected} session=${session} act=${act} />
    </div>
  </div>`
}

function Messages({ job, act, session }) {
  const [text, setText] = useState('')
  if (!job) return html`<${Empty} title="No task selected" body="Select a claimed task before sending messages." />`
  if (isOpen(job)) return html`<div class="escrow-workspace-grid">
    <${Empty} title="Task not claimed yet" body="Messages open after a worker claims the task." />
    <${DetailPanel} job=${job} session=${session} act=${act} />
  </div>`
  const author = session.role === 'worker' ? 'worker' : 'employer'
  return html`<div class="escrow-workspace-grid">
    <section class="escrow-main-panel">
      <div class="escrow-section-head"><h2>Messages</h2><span>${job.messages.length}</span></div>
      <div class="escrow-thread">
        ${job.messages.map((msg, i) => html`<p key=${i} class=${msg.author}><b>${msg.author}</b><span>${msg.text}</span><small>${new Date(msg.at).toLocaleString()}</small></p>`)}
        ${!job.messages.length && html`<p class="escrow-muted">No messages yet.</p>`}
      </div>
      <div class="escrow-compose">
        <input value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${`Message as ${author}`} />
        <button class="escrow-primary" disabled=${!text.trim()} onClick=${() => act(async () => {
          await api(`/api/jobs/${job.id}/messages`, { author, text })
          setText('')
        })}>Send</button>
      </div>
    </section>
    <${DetailPanel} job=${job} session=${session} act=${act} />
  </div>`
}

function Delivery({ job, act }) {
  const [submission, setSubmission] = useState({ url: '', repo: '', notes: '' })
  const set = (key) => (e) => setSubmission({ ...submission, [key]: e.target.value })
  if (!job) return html`<${Empty} title="No delivery selected" body="Select claimed work to submit evidence." />`
  if (isOpen(job)) return html`<div class="escrow-workspace-grid">
    <${Empty} title="No worker yet" body="A worker must claim this task before delivery can begin." />
    <${DetailPanel} job=${job} />
  </div>`
  return html`<div class="escrow-workspace-grid">
    <section class="escrow-main-panel">
      <div class="escrow-section-head"><h2>Delivery room</h2><${Badge} status=${job.status} /></div>
      <div class="escrow-milestone-board">
        ${job.milestones.map((m) => html`<div key=${m.id} class=${`escrow-milestone-card ${m.status}`}>
          <div><b>${m.title}</b><span>${money(m.amountSol)}</span></div>
          <button class="escrow-ghost" disabled=${!canWork(job) || m.status === 'complete'} onClick=${() => act(() => api(`/api/jobs/${job.id}/milestones/${m.id}/complete`, { actor: 'worker' }))}>
            ${m.status === 'complete' ? 'Done' : 'Mark done'}
          </button>
        </div>`)}
      </div>
      <form class="escrow-submit" onSubmit=${(e) => {
        e.preventDefault()
        act(() => api(`/api/jobs/${job.id}/submission`, submission))
      }}>
        <${Field} label="Preview URL"><input value=${submission.url} onInput=${set('url')} /></${Field}>
        <${Field} label="Repository"><input value=${submission.repo} onInput=${set('repo')} /></${Field}>
        <${Field} label="Delivery notes"><textarea value=${submission.notes} onInput=${set('notes')} /></${Field}>
        <button class="escrow-primary" disabled=${!canWork(job)}>Submit evidence</button>
      </form>
    </section>
    <${DetailPanel} job=${job} />
  </div>`
}

function ReviewReport({ review }) {
  const checks = review.checks || []
  const missing = review.missing || []
  const risks = review.risks || []
  const recommendation = review.recommendation || (review.approved ? 'approve' : 'revision')
  const source = review.source === 'ai' ? 'AI review' : review.source === 'fallback' ? 'Review unavailable' : 'Legacy review'
  return html`<section class=${`escrow-review-result ${recommendation}`}>
    <div class="escrow-review-top">
      <div>
        <span>${source}</span>
        <b>${review.score ?? 0}<small>/100</small></b>
      </div>
      <strong class=${`escrow-review-pill ${recommendation}`}>${statusText(recommendation)}</strong>
    </div>
    <p>${review.summary}</p>
    ${checks.length ? html`<div class="escrow-review-checks">
      ${checks.map((check, i) => html`<div class=${`escrow-review-check ${check.status}`} key=${i}>
        <b>${check.label}</b>
        <span>${statusText(check.status)}</span>
        <p>${check.reason || check.evidence || 'No detail provided.'}</p>
      </div>`)}
    </div>` : null}
    ${missing.length ? html`<div class="escrow-review-list"><b>Missing evidence</b><p>${missing.join(', ')}</p></div>` : null}
    ${risks.length ? html`<div class="escrow-review-list"><b>Risks</b><p>${risks.join(', ')}</p></div>` : null}
  </section>`
}

function Review({ job, act }) {
  if (!job) return html`<${Empty} title="No review selected" body="Select submitted work to review delivery evidence." />`
  if (isOpen(job)) return html`<div class="escrow-workspace-grid">
    <${Empty} title="No submission yet" body="Open tasks cannot be reviewed until a worker claims and submits work." />
    <${DetailPanel} job=${job} />
  </div>`
  const canReview = Boolean(job.submission) && !isTerminal(job) && job.status !== 'disputed'
  const canRelease = canReview && job.review?.recommendation === 'approve'
  const revisionNote = (job.review?.missing || []).join('; ') || 'Please address the AI review notes and resubmit evidence.'
  return html`<div class="escrow-workspace-grid">
    <section class="escrow-main-panel">
      <div class="escrow-section-head"><h2>Review desk</h2><${Badge} status=${job.status} /></div>
      <div class="escrow-evidence">
        <div><span>Preview</span>${job.submission?.url ? html`<a href=${job.submission.url} target="_blank">${job.submission.url}</a>` : html`<b>Missing</b>`}</div>
        <div><span>Repository</span>${job.submission?.repo ? html`<a href=${job.submission.repo} target="_blank">${job.submission.repo}</a>` : html`<b>Missing</b>`}</div>
        <p>${job.submission?.notes || 'No worker evidence has been submitted yet.'}</p>
      </div>
      ${job.review && html`<${ReviewReport} review=${job.review} />`}
      <div class="escrow-action-bar">
        <button class="escrow-primary" disabled=${!canReview} onClick=${() => act(() => api(`/api/jobs/${job.id}/review`, { action: 'assess' }))}>Run AI review</button>
        <button class="escrow-primary" disabled=${!canRelease} onClick=${() => act(() => api(`/api/jobs/${job.id}/review`, { action: 'approve' }))}>Approve and release</button>
        <button class="escrow-ghost" disabled=${!canReview || !job.review} onClick=${() => act(() => api(`/api/jobs/${job.id}/review`, { action: 'request_revision', note: revisionNote }))}>Request revision</button>
        <button class="escrow-ghost" disabled=${isTerminal(job) || isOpen(job)} onClick=${() => act(() => api(`/api/jobs/${job.id}/dispute`, { by: 'employer', note: 'Needs manual review before settlement.' }))}>Open dispute</button>
      </div>
    </section>
    <${DetailPanel} job=${job} />
  </div>`
}

function Payments({ job, data, act }) {
  const ledger = job?.settlement?.events || []
  return html`<div class="escrow-workspace-grid">
    <section class="escrow-main-panel">
      <div class="escrow-section-head"><h2>Payments</h2><span>${data.setup?.mode}</span></div>
      ${job ? html`
        <dl class="escrow-definition wide">
          <div><dt>Status</dt><dd>${statusText(job.status)}</dd></div>
          <div><dt>Escrow account</dt><dd>${job.settlement.escrow}</dd></div>
          <div><dt>Release</dt><dd>${job.settlement.release || '--'}</dd></div>
          <div><dt>Refund</dt><dd>${job.settlement.refund || '--'}</dd></div>
        </dl>
        <div class="escrow-action-bar">
          <button class="escrow-ghost" disabled=${isTerminal(job) || isOpen(job)} onClick=${() => act(() => api(`/api/jobs/${job.id}/refund`, {}))}>Refund</button>
          <button class="escrow-ghost" disabled=${isTerminal(job) || job.submission} onClick=${() => act(() => api(`/api/jobs/${job.id}/cancel`, {}))}>Cancel</button>
        </div>
        <div class="escrow-ledger">
          ${ledger.map((event, i) => html`<p key=${i}><b>${event.type}</b><span>${event.summary}</span><small>${new Date(event.at).toLocaleString()}</small></p>`)}
          ${!ledger.length && html`<p class="escrow-muted">No settlement events yet.</p>`}
        </div>
      ` : html`<${Empty} title="No payment selected" body="Select a task to inspect escrow movement." />`}
    </section>
    <${DetailPanel} job=${job} />
  </div>`
}

function Settings({ data, act, refresh }) {
  const [diagnostics, setDiagnostics] = useState(null)
  const [importText, setImportText] = useState('')
  return html`<div class="escrow-workspace-grid">
    <section class="escrow-main-panel">
      <div class="escrow-section-head"><h2>Workspace settings</h2><span>${data.setup?.mode}</span></div>
      <p class="escrow-muted">${data.setup?.note}</p>
      <div class="escrow-action-bar">
        <button class="escrow-primary" onClick=${() => act(() => api('/api/demo/seed', {}))}>Seed sample contract</button>
        <button class="escrow-ghost" onClick=${() => act(() => api('/api/state/reset', {}))}>Reset local jobs</button>
        <button class="escrow-ghost" onClick=${refresh}>Reload</button>
        <button class="escrow-ghost" onClick=${async () => setDiagnostics(await api('/api/health'))}>Diagnostics</button>
      </div>
      ${diagnostics && html`<pre>${JSON.stringify(diagnostics, null, 2)}</pre>`}
    </section>
    <section class="escrow-main-panel">
      <div class="escrow-section-head"><h2>Import / export</h2></div>
      <button class="escrow-ghost" onClick=${async () => {
        const payload = await api('/api/export')
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'freelance-escrow-platform-export.json'
        a.click()
        URL.revokeObjectURL(a.href)
      }}>Export JSON</button>
      <textarea value=${importText} onInput=${(e) => setImportText(e.target.value)} placeholder="Paste an export JSON blob" />
      <button class="escrow-primary" disabled=${!importText.trim()} onClick=${() => act(async () => {
        await api('/api/import', JSON.parse(importText))
        setImportText('')
      })}>Import JSON</button>
    </section>
  </div>`
}

function Marketplace({ data, selected, selectedId, setSelectedId, session, createTask, act }) {
  const summary = data.summary || {}
  const heading = session.role === 'worker' ? 'Find work' : 'Task marketplace'
  return html`<div class="escrow-view">
    <section class="escrow-page-head">
      <div>
        <p class="escrow-kicker">${session.role} account</p>
        <h1>${heading}</h1>
      </div>
      <div class="escrow-page-metrics">
        <span><b>${summary.openJobs ?? 0}</b> open</span>
        <span><b>${summary.claimedJobs ?? 0}</b> active</span>
        <span><b>${summary.inReview ?? 0}</b> review</span>
      </div>
    </section>
    ${session.role === 'employer' ? html`<${PostTask} session=${session} createTask=${createTask} />` : null}
    <div class="escrow-workspace-grid">
      <section class="escrow-main-panel">
        <div class="escrow-section-head"><h2>${heading}</h2><span>${data.jobs.length} records</span></div>
        <${TaskSections} jobs=${data.jobs} selectedId=${selectedId} setSelectedId=${setSelectedId} session=${session} />
      </section>
      <${DetailPanel} job=${selected} session=${session} act=${act} />
    </div>
  </div>`
}

function AppShell({ session, data, selected, selectedId, setSelectedId, view, setView, refresh, busy, error, onLogout, children }) {
  return html`<div class="escrow-app">
    <${Sidebar} view=${view} setView=${setView} data=${data} session=${session} />
    <section class="escrow-content">
      <${Topbar} session=${session} refresh=${refresh} busy=${busy} onLogout=${onLogout} />
      ${error && html`<p class="escrow-error">${error}</p>`}
      ${children}
    </section>
  </div>`
}

function App() {
  const [session, setSession] = useState(loadSession)
  const [data, setData] = useState({ jobs: [], summary: {}, setup: { wallets: {}, note: '' } })
  const [selectedId, setSelectedId] = useState('')
  const [view, setView] = useState('marketplace')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = async () => {
    const next = await api('/api/platform')
    setData(next)
    setSelectedId((current) => next.jobs.some((job) => job.id === current) ? current : preferredJobId(next.jobs, session))
  }

  const act = async (fn) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const createTask = async (payload) => {
    setBusy(true)
    setError('')
    try {
      const next = await api('/api/jobs', payload)
      setData(next)
      setSelectedId(next.jobs[0]?.id || '')
      setView('marketplace')
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (session) refresh().catch((e) => setError(e.message || String(e)))
  }, [session])

  const selected = useMemo(
    () => data.jobs.find((job) => job.id === selectedId) || data.jobs[0],
    [data.jobs, selectedId],
  )

  const login = (nextSession) => {
    setSession(nextSession)
    setView('marketplace')
  }

  if (!session) return html`<${Login} onLogin=${login} />`

  const logout = () => {
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
  }

  const content = view === 'marketplace' ? html`<${Marketplace} data=${data} selected=${selected} selectedId=${selectedId} setSelectedId=${setSelectedId} session=${session} createTask=${createTask} act=${act} />`
    : view === 'messages' ? html`<${Messages} job=${selected} act=${act} session=${session} />`
    : view === 'delivery' ? html`<${Delivery} job=${selected} act=${act} />`
    : view === 'review' ? html`<${Review} job=${selected} act=${act} />`
    : view === 'payments' ? html`<${Payments} job=${selected} data=${data} act=${act} />`
    : view === 'settings' ? html`<${Settings} data=${data} act=${act} refresh=${refresh} />`
    : html`<${Dashboard} data=${data} selected=${selected} selectedId=${selectedId} setSelectedId=${setSelectedId} session=${session} act=${act} />`

  return html`<${AppShell}
    session=${session}
    data=${data}
    selected=${selected}
    selectedId=${selectedId}
    setSelectedId=${setSelectedId}
    view=${view}
    setView=${setView}
    refresh=${refresh}
    busy=${busy}
    error=${error}
    onLogout=${logout}
  >
    ${content}
  </${AppShell}>`
}

createRoot(document.getElementById('root')).render(html`<${App} />`)
