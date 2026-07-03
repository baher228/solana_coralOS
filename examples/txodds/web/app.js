import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import htm from 'htm'
import {
  ArrowLeft,
  BriefcaseBusiness,
  ChevronDown,
  LayoutDashboard,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings as SettingsIcon,
  Wallet as WalletIcon,
} from 'lucide-react'
import * as Tabs from '@radix-ui/react-tabs'
import * as Collapsible from '@radix-ui/react-collapsible'

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
  ['dashboard', 'Dashboard', LayoutDashboard],
  ['jobs', 'Your Jobs', BriefcaseBusiness],
  ['chats', 'Chats', MessageCircle],
  ['wallet', 'Wallet', WalletIcon],
  ['settings', 'Admin tools', SettingsIcon],
]
const chatFilterLabels = {
  all: 'All',
  active: 'Active',
  needsReply: 'Needs reply',
  review: 'In review',
  completed: 'Completed',
}

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

function moneyMaybe(value) {
  return value == null ? '--' : money(value)
}

function short(value) {
  return value ? `${String(value).slice(0, 6)}...${String(value).slice(-4)}` : '--'
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--'
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

function canSubmitWork(job, session) {
  return canWork(job) && session?.role === 'worker' && job.worker === session.organization
}

function canReviewWork(job, session) {
  return canWork(job) && session?.role === 'employer' && job.employer === session.organization && Boolean(job.submission)
}

function isJobParty(job, session) {
  return Boolean(job && session && (job.employer === session.organization || job.worker === session.organization))
}

function activeDispute(job) {
  return (job?.disputes || []).find((dispute) => dispute.status === 'open')
}

function counterparty(job, session) {
  if (!job || !session) return 'Counterparty'
  return session.role === 'worker' ? party(job.employer) : party(job.worker || 'Unassigned worker')
}

function isReviewStatus(job) {
  return ['submitted', 'revision_requested', 'disputed'].includes(job?.status)
}

function lastItem(items) {
  return items?.length ? items[items.length - 1] : null
}

function jobSections(jobs, session) {
  const org = session?.organization
  const partyJobs = jobs.filter((job) => isJobParty(job, session))
  const openTasks = jobs.filter(isOpen)
  const review = partyJobs.filter(isReviewStatus)
  const completed = partyJobs.filter(isTerminal)
  return session?.role === 'worker'
    ? [
      ['working', 'Working on', 'Claimed jobs assigned to you', partyJobs.filter((job) => job.worker === org && !isOpen(job) && !isTerminal(job))],
      ['available', 'Available', 'Open jobs ready to claim', openTasks],
      ['review', 'In review', 'Submitted, disputed, or revision work', review],
      ['completed', 'Completed', 'Released, refunded, or cancelled jobs', completed],
    ]
    : [
      ['posted', 'Posted', 'Jobs posted by your organization', jobs.filter((job) => job.employer === org)],
      ['available', 'Open market', 'Open jobs from other teams', openTasks.filter((job) => job.employer !== org)],
      ['review', 'In review', 'Submitted, disputed, or revision work', review],
      ['completed', 'Completed', 'Released, refunded, or cancelled jobs', completed],
    ]
}

function chatConversations(jobs, session) {
  const replyAuthor = session?.role === 'worker' ? 'employer' : 'worker'
  return jobs
    .filter((job) => !isOpen(job) && isJobParty(job, session))
    .map((job) => {
      const last = lastItem(job.messages)
      return {
        job,
        last,
        counterparty: counterparty(job, session),
        needsReply: last?.author === replyAuthor,
        active: !isTerminal(job),
        review: isReviewStatus(job),
        completed: isTerminal(job),
        at: last?.at || job.submission?.at || job.createdAt,
      }
    })
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
}

function conversationFilters(conversations) {
  return [
    ['all', conversations],
    ['active', conversations.filter((item) => item.active)],
    ['needsReply', conversations.filter((item) => item.needsReply)],
    ['review', conversations.filter((item) => item.review)],
    ['completed', conversations.filter((item) => item.completed)],
  ]
}

function userBalance(data, session) {
  const role = session?.role === 'worker' ? 'worker' : 'employer'
  const wallets = data.setup?.wallets || {}
  return {
    role,
    address: wallets[role],
    balance: wallets.balances?.[`${role}Sol`],
  }
}

function transactionImpact(job, event, session) {
  const amount = money(job.amountSol)
  if (event.type === 'released') return session?.role === 'worker' ? `+${amount}` : `-${amount}`
  if (event.type === 'refunded') return session?.role === 'employer' ? `+${amount}` : `-${amount}`
  if (event.type === 'funded') return session?.role === 'employer' ? `-${amount}` : `${amount} locked`
  return amount
}

function walletTransactions(jobs, session) {
  return jobs
    .filter((job) => isJobParty(job, session))
    .flatMap((job) => (job.settlement?.events || []).map((event, index) => ({
      id: `${job.id}-${event.type}-${event.at}-${index}`,
      job,
      event,
      impact: transactionImpact(job, event, session),
    })))
    .sort((a, b) => String(b.event.at || '').localeCompare(String(a.event.at || '')))
}

function preferredJobId(jobs, session) {
  const org = session?.organization
  const preferred = session?.role === 'worker'
    ? jobs.find((job) => job.worker === org && !isOpen(job)) || jobs.find((job) => job.status === 'open')
    : jobs.find((job) => job.employer === org) || jobs.find((job) => job.status === 'open')
  return preferred?.id || jobs[0]?.id || ''
}

function Badge({ status }) {
  return html`<span class=${`escrow-badge ${status || ''}`}>${statusText(status)}</span>`
}

function Icon({ icon: Glyph, size = 17 }) {
  return html`<${Glyph} size=${size} strokeWidth=${2} aria-hidden="true" />`
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
  const conversations = chatConversations(data.jobs || [], session)
  const transactions = walletTransactions(data.jobs || [], session)
  const badgeFor = (id) => id === 'jobs'
    ? counts.activeJobs
    : id === 'chats'
      ? conversations.filter((item) => item.needsReply).length
      : id === 'wallet'
        ? transactions.length
        : null
  return html`<aside class="escrow-sidebar">
    <div class="escrow-brand">
      <div class="escrow-mark">FE</div>
      <div><b>Escrow Desk</b><span>Local settlement workspace</span></div>
    </div>
    <button class="escrow-new" onClick=${() => setView('jobs')}>
      <${Icon} icon=${Plus} />
      <span>${session.role === 'worker' ? 'Find work' : 'Post job'}</span>
    </button>
    <nav class="escrow-nav">
      ${nav.map(([id, label, Glyph]) => html`<button key=${id} class=${view === id ? 'on' : ''} onClick=${() => setView(id)}>
        <span><${Icon} icon=${Glyph} />${label}</span>
        ${badgeFor(id) ? html`<b>${badgeFor(id)}</b>` : null}
      </button>`)}
    </nav>
    <div class="escrow-side-note">
      <span>Signed in as</span>
      <b>${session.organization}</b>
      <small>${session.role}</small>
    </div>
    <div class="escrow-side-tools">
      <a href="./legacy.html">Legacy demo</a>
    </div>
  </aside>`
}

function Topbar({ session, refresh, busy, onLogout }) {
  return html`<header class="escrow-topbar">
    <div class="escrow-search"><${Icon} icon=${Search} /><input placeholder="Search jobs, clients, references" /></div>
    <div class="escrow-account">
      <button class="escrow-ghost iconed" disabled=${busy} onClick=${refresh}><${Icon} icon=${RefreshCw} /><span>Refresh</span></button>
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
      <span>Task</span><span>Client / worker</span><span>Budget</span><span>Status</span>
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
      <div><b>Post an open job</b><span>Set scope, milestones, and budget. Workers claim it from the job board.</span></div>
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

function SubmissionEvidence({ job }) {
  if (!job?.submission) return null
  return html`<section class="escrow-evidence">
    <div><span>Preview</span>${job.submission.url ? html`<a href=${job.submission.url} target="_blank">${job.submission.url}</a>` : html`<b>Missing</b>`}</div>
    <div><span>Repository</span>${job.submission.repo ? html`<a href=${job.submission.repo} target="_blank">${job.submission.repo}</a>` : html`<b>Missing</b>`}</div>
    <p>${job.submission.notes || 'No worker notes were submitted.'}</p>
  </section>`
}

function MarketplaceStatus({ job }) {
  const market = job?.marketplace
  const devnet = job?.settlement?.devnet
  if (!market && !devnet) return null
  const awarded = market?.awardedBid
  return html`<section class="escrow-mini-list">
    <div class="escrow-section-head"><h3>Agent marketplace</h3><span>${market?.status || job.settlement.mode}</span></div>
    ${market ? html`<p><span>Posted budget</span><b>${money(market.budgetSol)}</b></p>` : null}
    ${market ? html`<p><span>Bids</span><b>${market.bids?.length || 0}</b></p>` : null}
    ${awarded ? html`<p><span>Awarded agent</span><b>${awarded.by}</b></p>` : null}
    ${awarded ? html`<p><span>Winning bid</span><b>${money(awarded.priceSol)}</b></p>` : null}
    ${devnet ? html`<p><span>Worker wallet</span><b title=${devnet.seller}>${short(devnet.seller)}</b></p>` : null}
    ${devnet?.deposit ? html`<p><span>Deposit sig</span><b title=${devnet.deposit}>${short(devnet.deposit)}</b></p>` : null}
    ${devnet?.release ? html`<p><span>Release sig</span><b title=${devnet.release}>${short(devnet.release)}</b></p>` : null}
    ${devnet?.refund ? html`<p><span>Refund sig</span><b title=${devnet.refund}>${short(devnet.refund)}</b></p>` : null}
  </section>`
}

function DisputePanel({ dispute }) {
  return html`<section class="escrow-dispute-panel">
    <div>
      <span>${dispute.status === 'open' ? 'Active dispute' : 'Resolved dispute'}</span>
      <b>${dispute.by === 'worker' ? 'Worker' : 'Employer'}</b>
    </div>
    <p>${dispute.note}</p>
    ${dispute.summary ? html`<small>${dispute.summary}</small>` : null}
    ${dispute.outcome ? html`<strong>${statusText(dispute.outcome)}</strong>` : null}
  </section>`
}

function DeliveryActions({ job, session, act }) {
  const [submission, setSubmission] = useState({ url: '', repo: '', notes: '' })
  useEffect(() => {
    setSubmission({
      url: job?.submission?.url || '',
      repo: job?.submission?.repo || '',
      notes: job?.submission?.notes || '',
    })
  }, [job?.id])
  if (!canSubmitWork(job, session)) return null
  const set = (key) => (e) => setSubmission({ ...submission, [key]: e.target.value })
  return html`<section class="escrow-task-action">
    <div class="escrow-section-head"><h3>${job.submission ? 'Resubmit work' : 'Submit work'}</h3><span>${statusText(job.status)}</span></div>
    <form class="escrow-submit" onSubmit=${(e) => {
      e.preventDefault()
      act(() => api(`/api/jobs/${job.id}/submission`, submission))
    }}>
      <${Field} label="Preview URL"><input value=${submission.url} onInput=${set('url')} /></${Field}>
      <${Field} label="Repository"><input value=${submission.repo} onInput=${set('repo')} /></${Field}>
      <${Field} label="Delivery notes"><textarea value=${submission.notes} onInput=${set('notes')} /></${Field}>
      <button class="escrow-primary">${job.submission ? 'Resubmit work' : 'Submit work'}</button>
    </form>
  </section>`
}

function ReviewActions({ job, session, act }) {
  const [disputeNote, setDisputeNote] = useState('')
  useEffect(() => setDisputeNote(''), [job?.id])
  if (!job?.submission && !job?.review) return null
  const employerCanReview = canReviewWork(job, session)
  const dispute = activeDispute(job)
  const releaseEligible = Boolean(job.review?.releaseEligible)
  const canRunDisputeReview = job.status === 'disputed' && dispute && isJobParty(job, session)
  const canRelease = employerCanReview && releaseEligible && !dispute
  const canOpenDispute = canRelease
  const revisionNote = job.review?.revisionInstructions || (job.review?.missing || []).join('; ') || 'Please address the AI review notes and resubmit evidence.'
  const title = session?.role === 'worker' ? 'Review feedback' : 'Review and settlement'
  return html`<section class="escrow-task-action">
    <div class="escrow-section-head"><h3>${title}</h3><span>${releaseEligible ? 'release eligible' : statusText(job.status)}</span></div>
    <${SubmissionEvidence} job=${job} />
    ${dispute && html`<${DisputePanel} dispute=${dispute} />`}
    ${job.review?.artifactRun && html`<${ArtifactReport} job=${job} run=${job.review.artifactRun} />`}
    ${job.review && html`<${ReviewReport} review=${job.review} />`}
    ${employerCanReview ? html`<div class="escrow-action-bar">
      <button class="escrow-primary" onClick=${() => act(() => api(`/api/jobs/${job.id}/review`, { action: 'assess' }))}>Run AI review</button>
      <button class="escrow-primary" disabled=${!canRelease} onClick=${() => act(() => api(`/api/jobs/${job.id}/review`, { action: 'approve' }))}>Approve and release</button>
      <button class="escrow-ghost" disabled=${!job.review} onClick=${() => act(() => api(`/api/jobs/${job.id}/review`, { action: 'request_revision', note: revisionNote }))}>Request revision</button>
    </div>` : null}
    ${canOpenDispute ? html`<div class="escrow-dispute-form">
      <${Field} label="Dispute reason"><textarea value=${disputeNote} onInput=${(e) => setDisputeNote(e.target.value)} placeholder="Name the acceptance item and what evidence is missing." /></${Field}>
      <button class="escrow-ghost" disabled=${disputeNote.trim().length < 20} onClick=${() => act(() => api(`/api/jobs/${job.id}/dispute`, { by: 'employer', note: disputeNote }))}>Open dispute</button>
    </div>` : null}
    ${canRunDisputeReview ? html`<div class="escrow-action-bar">
      <button class="escrow-primary" onClick=${() => act(() => api(`/api/jobs/${job.id}/dispute/review`, {}))}>Run dispute review</button>
    </div>` : null}
  </section>`
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
    <${MarketplaceStatus} job=${job} />
    <section class="escrow-terms">
      <b>Scope</b>
      <p>${job.scope || job.requirements}</p>
      <b>Acceptance</b>
      <p>${job.acceptanceCriteria}</p>
    </section>
    ${act && html`<${DeliveryActions} job=${job} session=${session} act=${act} />`}
    ${act && html`<${ReviewActions} job=${job} session=${session} act=${act} />`}
    <section class="escrow-mini-list">
      <div class="escrow-section-head"><h3>Milestones</h3><span>${done}/${job.milestones.length}</span></div>
      ${job.milestones.map((m) => html`<p key=${m.id} class=${m.status}>
        <span>${m.title}</span>
        <b>${money(m.amountSol)}</b>
      </p>`)}
    </section>
  </aside>`
}

function JobTabs({ jobs, selectedId, setSelectedId, session }) {
  const sections = jobSections(jobs, session)
  const defaultValue = sections[0]?.[0]
  return html`<${Tabs.Root} class="escrow-tabs" defaultValue=${defaultValue}>
    <${Tabs.List} class="escrow-tab-list" aria-label="Job sections">
      ${sections.map(([id, title, , sectionJobs]) => html`<${Tabs.Trigger} key=${id} value=${id} class="escrow-tab-trigger">
        <span>${title}</span>
        <b>${sectionJobs.length}</b>
      </${Tabs.Trigger}>`)}
    </${Tabs.List}>
    ${sections.map(([id, title, subtitle, sectionJobs]) => html`<${Tabs.Content} key=${id} value=${id} class="escrow-tab-panel">
      <section class="escrow-list-section">
        <div class="escrow-section-head"><div><h3>${title}</h3><span>${subtitle}</span></div><span>${sectionJobs.length}</span></div>
        <${TaskTable} jobs=${sectionJobs} selectedId=${selectedId} setSelectedId=${setSelectedId} emptyTitle=${`No ${title.toLowerCase()}`} emptyBody="Nothing matches this section yet." />
      </section>
    </${Tabs.Content}>`)}
  </${Tabs.Root}>`
}

function Dashboard({ data, selected, selectedId, setSelectedId, session, act }) {
  const jobs = data.jobs || []
  const summary = data.summary || {}
  const balance = userBalance(data, session)
  const sections = jobSections(jobs, session)
  const queue = sections[0]?.[3] || []
  return html`<div class="escrow-view">
    <section class="escrow-page-head">
      <div>
        <p class="escrow-kicker">${session.role} command center</p>
        <h1>Dashboard</h1>
      </div>
      <div class="escrow-page-metrics">
        <span><b>${summary.activeJobs ?? 0}</b> active</span>
        <span><b>${summary.lockedSol ?? 0}</b> locked SOL</span>
        <span><b>${summary.disputedJobs ?? 0}</b> disputes</span>
      </div>
    </section>
    <section class="escrow-stats">
      <${Stat} label="Open tasks" value=${summary.openJobs ?? 0} sub=${`${summary.totalJobs ?? jobs.length} total`} />
      <${Stat} label="Active contracts" value=${summary.claimedJobs ?? 0} sub="claimed work" />
      <${Stat} label="Needs review" value=${summary.inReview ?? 0} sub="submitted evidence" />
      <${Stat} label=${`${balance.role} balance`} value=${moneyMaybe(balance.balance)} sub=${short(balance.address)} />
    </section>
    <div class="escrow-workspace-grid">
      <section class="escrow-main-panel">
        <div class="escrow-section-head"><h2>Priority queue</h2><span>${queue.length} records</span></div>
        <${TaskTable} jobs=${queue} selectedId=${selectedId} setSelectedId=${setSelectedId} emptyTitle="No priority jobs" emptyBody="Your role-specific work queue is clear." />
      </section>
      <${DetailPanel} job=${selected} session=${session} act=${act} />
    </div>
  </div>`
}

function Chats({ jobs, selectedId, setSelectedId, act, session }) {
  const [filter, setFilter] = useState('all')
  const [text, setText] = useState('')
  const [threadOpen, setThreadOpen] = useState(false)
  const conversations = chatConversations(jobs, session)
  const filters = conversationFilters(conversations)
  const visible = filters.find(([id]) => id === filter)?.[1] || conversations
  const selectedConversation = conversations.find((item) => item.job.id === selectedId) || visible[0] || conversations[0]
  const job = selectedConversation?.job
  const author = session.role === 'worker' ? 'worker' : 'employer'
  const openThread = (id) => {
    setSelectedId(id)
    setThreadOpen(true)
    setText('')
  }
  return html`<div class="escrow-view">
    <section class="escrow-page-head">
      <div>
        <p class="escrow-kicker">job conversations</p>
        <h1>Chats</h1>
      </div>
      <div class="escrow-page-metrics">
        <span><b>${conversations.length}</b> threads</span>
        <span><b>${conversations.filter((item) => item.needsReply).length}</b> replies</span>
        <span><b>${conversations.filter((item) => item.review).length}</b> review</span>
      </div>
    </section>
    <div class=${`escrow-chat-shell ${threadOpen ? 'open' : ''}`}>
      <section class="escrow-chat-list">
        <div class="escrow-section-head"><div><h2>Inbox</h2><span>Claimed job threads only</span></div><span>${visible.length}</span></div>
        <div class="escrow-chat-filters">
          ${filters.map(([id, items]) => html`<button key=${id} class=${filter === id ? 'on' : ''} onClick=${() => setFilter(id)}>
            ${chatFilterLabels[id]} <b>${items.length}</b>
          </button>`)}
        </div>
        <div class="escrow-conversation-list">
          ${visible.map(({ job: item, last, counterparty: who, needsReply }) => html`<button
            key=${item.id}
            class=${`escrow-conversation ${job?.id === item.id ? 'on' : ''}`}
            onClick=${() => openThread(item.id)}
          >
            <${Avatar} name=${who} />
            <span>
              <b>${item.title}</b>
              <small>${who}</small>
              <em>${last?.text || 'No messages yet.'}</em>
            </span>
            <i>
              ${needsReply ? html`<strong>reply</strong>` : null}
              <small>${formatTime(last?.at || item.createdAt)}</small>
              <${Badge} status=${item.status} />
            </i>
          </button>`)}
          ${!visible.length && html`<${Empty} title="No conversations" body="Claimed jobs with messages will appear here." />`}
        </div>
      </section>
      <section class="escrow-chat-pane">
        ${job ? html`
          <header class="escrow-chat-head">
            <button class="escrow-ghost escrow-chat-back" onClick=${() => setThreadOpen(false)}><${Icon} icon=${ArrowLeft} />Back</button>
            <${Avatar} name=${selectedConversation.counterparty} />
            <div><h2>${job.title}</h2><span>${selectedConversation.counterparty}</span></div>
            <${Badge} status=${job.status} />
          </header>
          <div class="escrow-thread large">
            ${job.messages.map((msg, i) => html`<p key=${i} class=${msg.author}><b>${msg.author}</b><span>${msg.text}</span><small>${formatTime(msg.at)}</small></p>`)}
            ${!job.messages.length && html`<p class="escrow-muted">No messages yet.</p>`}
          </div>
          <form class="escrow-compose large" onSubmit=${(e) => {
            e.preventDefault()
            if (!text.trim()) return
            act(async () => {
              await api(`/api/jobs/${job.id}/messages`, { author, text })
              setText('')
            })
          }}>
            <input value=${text} onInput=${(e) => setText(e.target.value)} placeholder=${`Message ${selectedConversation.counterparty}`} />
            <button class="escrow-primary" disabled=${!text.trim()}><${Icon} icon=${Send} />Send</button>
          </form>
        ` : html`<${Empty} title="Select a conversation" body="Choose a claimed job thread from the inbox." />`}
      </section>
    </div>
  </div>`
}

function artifactHref(job, artifact) {
  return `${API}/api/jobs/${job.id}/artifacts/${artifact.id}`
}

function ArtifactStatus({ label, item }) {
  return html`<div class=${`escrow-artifact-status ${item?.status || 'skipped'}`}>
    <span>${label}</span>
    <b>${statusText(item?.status || 'skipped')}</b>
    <p>${item?.summary || 'Not run'}</p>
    ${item?.commit ? html`<small>Commit ${item.commit}</small>` : null}
    ${item?.title ? html`<small>${item.title}</small>` : null}
    ${item?.command ? html`<small>${item.command}</small>` : null}
  </div>`
}

function ArtifactReport({ job, run }) {
  if (!run) return null
  const screenshots = run.screenshots || []
  const logs = run.logs || []
  return html`<section class="escrow-artifact-report">
    <div class="escrow-section-head">
      <h3>Artifact review</h3>
      <span>${new Date(run.at).toLocaleString()}</span>
    </div>
    <div class="escrow-artifact-grid">
      <${ArtifactStatus} label="Repository" item=${run.repo} />
      <${ArtifactStatus} label="Build" item=${run.build} />
      <${ArtifactStatus} label="Preview" item=${run.preview} />
    </div>
    ${screenshots.length ? html`<div class="escrow-screenshots">
      ${screenshots.map((shot) => html`<a key=${shot.id} href=${artifactHref(job, shot)} target="_blank">
        <img src=${artifactHref(job, shot)} alt=${shot.label} />
        <span>${shot.label}</span>
      </a>`)}
    </div>` : html`<p class="escrow-muted">No screenshots captured.</p>`}
    ${logs.length ? html`<div class="escrow-log-links">
      ${logs.map((log) => html`<a key=${log.id} href=${artifactHref(job, log)} target="_blank">${log.label}</a>`)}
    </div>` : null}
  </section>`
}

function ReviewReport({ review }) {
  const checks = review.criteriaResults?.length ? review.criteriaResults : (review.checks || [])
  const missing = review.missing || []
  const risks = [...(review.criticalRisks || []), ...(review.risks || [])]
  const recommendation = review.recommendation || (review.approved ? 'approve' : 'revision')
  const source = review.source === 'ai' ? 'Artifact AI review' : review.source === 'fallback' ? 'Review unavailable' : 'Legacy review'
  return html`<section class=${`escrow-review-result ${recommendation}`}>
    <div class="escrow-review-top">
      <div>
        <span>${source}</span>
        <b>${review.score ?? 0}<small>/100</small></b>
      </div>
      <strong class=${`escrow-review-pill ${review.releaseEligible ? 'approve' : recommendation}`}>${review.releaseEligible ? 'release eligible' : statusText(recommendation)}</strong>
    </div>
    <p>${review.summary}</p>
    ${review.autoReleaseAt && review.releaseEligible ? html`<div class="escrow-review-list"><b>Auto-release</b><p>${new Date(review.autoReleaseAt).toLocaleString()}</p></div>` : null}
    ${typeof review.confidence === 'number' ? html`<div class="escrow-review-list"><b>Confidence</b><p>${review.confidence}/100</p></div>` : null}
    ${checks.length ? html`<div class="escrow-review-checks">
      ${checks.map((check, i) => html`<div class=${`escrow-review-check ${check.status}`} key=${i}>
        <b>${check.label}</b>
        <span>${statusText(check.status)}</span>
        <p>${check.reason || 'No detail provided.'}</p>
        ${check.evidence ? html`<small>${check.evidence}</small>` : null}
      </div>`)}
    </div>` : null}
    ${missing.length ? html`<div class="escrow-review-list"><b>Missing evidence</b><p>${missing.join(', ')}</p></div>` : null}
    ${risks.length ? html`<div class="escrow-review-list"><b>Risks</b><p>${risks.join(', ')}</p></div>` : null}
    ${review.revisionInstructions ? html`<div class="escrow-review-list"><b>Revision instructions</b><p>${review.revisionInstructions}</p></div>` : null}
  </section>`
}

function TransactionRow({ tx, selectedId, setSelectedId }) {
  const { job, event, impact } = tx
  return html`<${Collapsible.Root} class=${`escrow-transaction ${selectedId === job.id ? 'on' : ''}`}>
    <${Collapsible.Trigger} asChild=${true}>
      <button class="escrow-transaction-trigger" onClick=${() => setSelectedId(job.id)}>
        <span><b>${statusText(event.type)}</b><small>${job.title}</small></span>
        <span><b>${impact}</b><small>${formatTime(event.at)}</small></span>
        <${Icon} icon=${ChevronDown} />
      </button>
    </${Collapsible.Trigger}>
    <${Collapsible.Content} class="escrow-transaction-breakdown">
      <dl>
        <div><dt>Summary</dt><dd>${event.summary}</dd></div>
        <div><dt>Escrow</dt><dd>${job.settlement.escrow}</dd></div>
        <div><dt>Reference</dt><dd>${job.reference}</dd></div>
        <div><dt>Mode</dt><dd>${job.settlement.mode}</dd></div>
        <div><dt>Worker wallet</dt><dd>${job.settlement.devnet?.seller || '--'}</dd></div>
        <div><dt>Deposit</dt><dd>${job.settlement.devnet?.deposit || '--'}</dd></div>
        <div><dt>Release</dt><dd>${job.settlement.release || '--'}</dd></div>
        <div><dt>Refund</dt><dd>${job.settlement.refund || '--'}</dd></div>
        <div><dt>Status</dt><dd>${statusText(job.status)}</dd></div>
      </dl>
    </${Collapsible.Content}>
  </${Collapsible.Root}>`
}

function WalletView({ data, selected, selectedId, setSelectedId, session, act }) {
  const account = userBalance(data, session)
  const transactions = walletTransactions(data.jobs || [], session)
  const selectedJob = isJobParty(selected, session) ? selected : transactions[0]?.job
  return html`<div class="escrow-view">
    <section class="escrow-page-head">
      <div>
        <p class="escrow-kicker">${data.setup?.mode || 'local-demo'}</p>
        <h1>Wallet</h1>
      </div>
      <div class="escrow-page-metrics">
        <span><b>${moneyMaybe(account.balance)}</b> balance</span>
        <span><b>${money(data.summary?.lockedSol)}</b> locked</span>
        <span><b>${transactions.length}</b> txns</span>
      </div>
    </section>
    <div class="escrow-workspace-grid">
      <section class="escrow-main-panel">
        <div class="escrow-section-head"><div><h2>Transactions</h2><span>Click any row for the settlement breakdown</span></div><span>${transactions.length}</span></div>
        <div class="escrow-transactions">
          ${transactions.map((tx) => html`<${TransactionRow} key=${tx.id} tx=${tx} selectedId=${selectedId} setSelectedId=${setSelectedId} />`)}
          ${!transactions.length && html`<${Empty} title="No wallet activity" body="Settlement events appear here after jobs are funded, reviewed, released, refunded, or cancelled." />`}
        </div>
        ${selectedJob ? html`<div class="escrow-action-bar wallet">
          <button class="escrow-ghost" disabled=${isTerminal(selectedJob) || isOpen(selectedJob)} onClick=${() => act(() => api(`/api/jobs/${selectedJob.id}/refund`, {}))}>Refund selected escrow</button>
          <button class="escrow-ghost" disabled=${isTerminal(selectedJob) || selectedJob.submission} onClick=${() => act(() => api(`/api/jobs/${selectedJob.id}/cancel`, {}))}>Cancel selected escrow</button>
        </div>` : null}
      </section>
      <${DetailPanel} job=${selectedJob} session=${session} act=${act} />
    </div>
  </div>`
}

function Settings({ data, act, refresh }) {
  const [diagnostics, setDiagnostics] = useState(null)
  const [importText, setImportText] = useState('')
  const [agentForm, setAgentForm] = useState({ name: 'demo-worker', wallet: '' })
  const [createdAgent, setCreatedAgent] = useState(null)
  const setAgent = (key) => (e) => setAgentForm({ ...agentForm, [key]: e.target.value })
  const agents = data.agents || []
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
      <div class="escrow-section-head"><h2>Connect agent</h2><span>${agents.filter((agent) => agent.status === 'active').length} active</span></div>
      <form class="escrow-create compact" onSubmit=${(e) => {
        e.preventDefault()
        act(async () => {
          const created = await api('/api/agents', {
            name: agentForm.name,
            wallet: agentForm.wallet,
          })
          setCreatedAgent(created)
        })
      }}>
        <div class="escrow-form-grid">
          <${Field} label="Agent name"><input value=${agentForm.name} onInput=${setAgent('name')} /></${Field}>
          <${Field} label="Payout wallet"><input value=${agentForm.wallet} onInput=${setAgent('wallet')} placeholder="optional if agent sends wallet" /></${Field}>
        </div>
        <button class="escrow-primary">Create token</button>
      </form>
      ${createdAgent && html`<div class="escrow-token-box">
        <div class="escrow-section-head"><h3>${createdAgent.agent.name}</h3><button class="escrow-ghost" onClick=${() => navigator.clipboard?.writeText(createdAgent.env)}>Copy env</button></div>
        <pre>${createdAgent.env}</pre>
      </div>`}
      <div class="escrow-agent-list">
        ${agents.length ? agents.map((agent) => html`<div class="escrow-agent-row" key=${agent.id}>
          <span><b>${agent.name}</b><small>${agent.status} · ${agent.lastSeenAt ? formatTime(agent.lastSeenAt) : 'never seen'}</small></span>
          <code>${agent.wallet ? short(agent.wallet) : 'wallet optional'}</code>
          ${agent.status === 'active' ? html`<button class="escrow-ghost" onClick=${() => act(() => api(`/api/agents/${agent.id}/revoke`, {}))}>Revoke</button>` : html`<b>Revoked</b>`}
        </div>`) : html`<${Empty} title="No connected agents" body="Create an agent token to let a worker poll jobs, bid, and deliver." />`}
      </div>
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

function YourJobs({ data, selected, selectedId, setSelectedId, session, createTask, act }) {
  const summary = data.summary || {}
  const heading = session.role === 'worker' ? 'Your work' : 'Your posted jobs'
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
        <div class="escrow-section-head"><h2>Job board</h2><span>${data.jobs.length} records</span></div>
        <${JobTabs} jobs=${data.jobs} selectedId=${selectedId} setSelectedId=${setSelectedId} session=${session} />
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
  const [view, setView] = useState('dashboard')
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
      setView('jobs')
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (session) refresh().catch((e) => setError(e.message || String(e)))
  }, [session])

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 })
    document.querySelector('.escrow-content')?.scrollTo({ top: 0, left: 0 })
  }, [view])

  const selected = useMemo(
    () => data.jobs.find((job) => job.id === selectedId) || data.jobs[0],
    [data.jobs, selectedId],
  )

  const login = (nextSession) => {
    setSession(nextSession)
    setView('dashboard')
  }

  if (!session) return html`<${Login} onLogin=${login} />`

  const logout = () => {
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
  }

  const content = view === 'jobs' ? html`<${YourJobs} data=${data} selected=${selected} selectedId=${selectedId} setSelectedId=${setSelectedId} session=${session} createTask=${createTask} act=${act} />`
    : view === 'chats' ? html`<${Chats} jobs=${data.jobs} selectedId=${selectedId} setSelectedId=${setSelectedId} act=${act} session=${session} />`
    : view === 'wallet' ? html`<${WalletView} data=${data} selected=${selected} selectedId=${selectedId} setSelectedId=${setSelectedId} session=${session} act=${act} />`
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
