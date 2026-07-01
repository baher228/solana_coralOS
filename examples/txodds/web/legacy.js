import React, { useEffect, useMemo, useState } from 'https://esm.sh/react@18.3.1'
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client'
import htm from 'https://esm.sh/htm@3.1.1'

const html = htm.bind(React.createElement)
const API = window.FREELANCE_API ?? window.FREELANCE_ESCROW_API ?? 'http://localhost:8801'

const STATUS_LABELS = {
  funded: 'Funded',
  submitted: 'Submitted',
  released: 'Released',
  revision_requested: 'Revision requested',
  disputed: 'Disputed',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
}

const JOB_PRESETS = [
  {
    label: 'Checkout',
    draft: {
      title: 'Responsive checkout landing page',
      requirements: 'Build a responsive landing page with pricing cards, FAQ section, and contact form.',
      acceptanceCriteria: 'Mobile layout works. Pricing cards, FAQ, and contact form are present. Include a public URL or repo.',
      amountSol: 0.02,
    },
  },
  {
    label: 'API docs',
    draft: {
      title: 'Developer API documentation',
      requirements: 'Write endpoint documentation for auth, errors, pagination, and webhook retries.',
      acceptanceCriteria: 'Includes curl examples, setup notes, and a repo or public URL for review.',
      amountSol: 0.01,
    },
  },
]

const SUBMISSION_PRESETS = [
  {
    label: 'Matching evidence',
    body: {
      url: 'https://example.test/freelance-delivery',
      repo: 'https://github.com/example/freelance-delivery',
      notes: 'Completed the requested delivery with responsive landing page, pricing cards, FAQ section, contact form, mobile layout, public URL, repo, endpoint documentation, auth, errors, pagination, webhook retries, curl examples, and setup notes.',
    },
  },
  {
    label: 'Incomplete evidence',
    body: {
      url: '',
      repo: '',
      notes: 'Changed the header color. Pricing cards, FAQ, contact form, docs, and setup notes are not included.',
    },
  },
]

const canSubmit = (job) => job && ['funded', 'submitted', 'revision_requested', 'disputed'].includes(job.status)
const canReview = (job) => job?.submission && !job.settlement?.release && !job.settlement?.refund && !['cancelled', 'refunded'].includes(job.status)
const canRefund = (job) => job && !job.settlement?.release && !job.settlement?.refund && !['cancelled', 'released'].includes(job.status)

const shortAddr = (value) => value ? `${String(value).slice(0, 4)}...${String(value).slice(-4)}` : '--'
const fmtSol = (value) => `${Number(value || 0).toFixed(Number(value || 0) < 0.01 ? 6 : 4)} SOL`
const fmtTime = (value) => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '--'

async function api(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

function StatusBadge({ status }) {
  return html`<span class=${`status ${status}`}>${STATUS_LABELS[status] || status || 'Idle'}</span>`
}

function Field({ label, children }) {
  return html`<label class="field"><span>${label}</span>${children}</label>`
}

function LinkLine({ label, href, text }) {
  return html`<div class="link-line">
    <span>${label}</span>
    ${href ? html`<a href=${href} target="_blank" rel="noreferrer">${text || href}</a>` : html`<b>${text || '--'}</b>`}
  </div>`
}

function QuoteBreakdown({ amountSol }) {
  return html`<div class="quote">
    <div class="quote-row"><span>Budget</span><b>${fmtSol(amountSol)}</b></div>
    <div class="quote-row"><span>Escrow mode</span><b>Local demo</b></div>
    <div class="quote-row total"><span>Estimated employer debit</span><b>${fmtSol(amountSol)}</b></div>
    <p>Secrets and old arbiter keys are not used. This page preserves the old workflow UI against the cleaned local API.</p>
  </div>`
}

function Composer({ onCreate, busy }) {
  const [draft, setDraft] = useState(JOB_PRESETS[0].draft)
  const set = (key) => (event) => setDraft({ ...draft, [key]: event.target.value })
  return html`<section class="panel composer">
    <div class="panel-head">
      <h2>Employer</h2>
      <span class="mini">Create and fund</span>
    </div>
    <form onSubmit=${(event) => { event.preventDefault(); onCreate(draft) }}>
      <div class="preset-row">
        ${JOB_PRESETS.map((preset) => html`<button type="button" key=${preset.label} onClick=${() => setDraft({ ...preset.draft })}>${preset.label}</button>`)}
      </div>
      <${Field} label="Task title"><input value=${draft.title} onInput=${set('title')} required /><//>
      <${Field} label="Requirements"><textarea rows="5" value=${draft.requirements} onInput=${set('requirements')} required /><//>
      <${Field} label="Acceptance criteria"><textarea rows="4" value=${draft.acceptanceCriteria} onInput=${set('acceptanceCriteria')} required /><//>
      <${Field} label="Budget"><input type="number" min="0.001" step="0.001" value=${draft.amountSol} onInput=${set('amountSol')} /><//>
      <${QuoteBreakdown} amountSol=${Number(draft.amountSol)} />
      <button class="primary" disabled=${busy}>Fund escrow</button>
    </form>
  </section>`
}

function JobList({ jobs, selected, onSelect, onSeed }) {
  return html`<section class="panel jobs-panel">
    <div class="panel-head">
      <h2>Jobs</h2>
      <button type="button" onClick=${onSeed}>Seed</button>
    </div>
    <div class="job-list">
      ${jobs.length === 0 && html`<p class="muted">No funded tasks yet.</p>`}
      ${jobs.map((job) => html`<button key=${job.id} class=${`job-item ${selected?.id === job.id ? 'active' : ''}`} onClick=${() => onSelect(job.id)}>
        <span>
          <b>${job.title}</b>
          <small>${fmtSol(job.amountSol)} - ${fmtTime(job.createdAt)}</small>
        </span>
        <${StatusBadge} status=${job.status} />
      </button>`)}
    </div>
  </section>`
}

function FlowStrip({ job }) {
  const funded = Boolean(job)
  const submitted = Boolean(job?.submission)
  const settled = Boolean(job?.settlement?.release || job?.settlement?.refund)
  return html`<section class="flow-strip">
    <div class=${funded ? 'flow-node done' : 'flow-node'}><b>1</b><span>Escrow funded</span></div>
    <div class=${submitted ? 'flow-node done' : 'flow-node'}><b>2</b><span>Work submitted</span></div>
    <div class=${settled ? 'flow-node done' : 'flow-node'}><b>3</b><span>Agent settles</span></div>
  </section>`
}

function ChatPanel({ job, onMessage, busy }) {
  const [author, setAuthor] = useState('employer')
  const [text, setText] = useState('')
  const send = (event) => {
    event.preventDefault()
    if (!text.trim()) return
    onMessage({ author, text }).then(() => setText(''))
  }
  return html`<section class="panel chat-panel">
    <div class="panel-head">
      <h2>Chat</h2>
      <span class="mini">${job?.messages?.length || 0} messages</span>
    </div>
    <div class="timeline">
      ${(job?.messages || []).map((msg, index) => html`<div class=${`msg ${msg.author}`} key=${index}>
        <span>${msg.author}</span>
        <p>${msg.text}</p>
        <small>${fmtTime(msg.at)}</small>
      </div>`)}
      ${(!job || job.messages.length === 0) && html`<p class="muted">Transcript evidence appears here.</p>`}
    </div>
    <form class="chat-form" onSubmit=${send}>
      <div class="segmented">
        <button type="button" class=${author === 'employer' ? 'on' : ''} onClick=${() => setAuthor('employer')}>Employer</button>
        <button type="button" class=${author === 'worker' ? 'on' : ''} onClick=${() => setAuthor('worker')}>Worker</button>
      </div>
      <input value=${text} onInput=${(event) => setText(event.target.value)} placeholder="Message" disabled=${!job || busy} />
      <button disabled=${!job || busy}>Send</button>
    </form>
  </section>`
}

function SubmissionPanel({ job, onSubmitDelivery, busy }) {
  const [submission, setSubmission] = useState({ url: '', repo: '', notes: '' })
  const set = (key) => (event) => setSubmission({ ...submission, [key]: event.target.value })
  const send = (event) => {
    event.preventDefault()
    onSubmitDelivery(submission).then(() => setSubmission({ url: '', repo: '', notes: '' }))
  }
  return html`<section class="panel submission-panel">
    <div class="panel-head">
      <h2>Worker</h2>
      <span class="mini">${job?.submission ? 'Evidence submitted' : 'Delivery'}</span>
    </div>
    ${job?.submission && html`<div class="evidence">
      <${LinkLine} label="URL" href=${job.submission.url} text=${job.submission.url} />
      <${LinkLine} label="Repo" href=${job.submission.repo} text=${job.submission.repo} />
      <p>${job.submission.notes || '--'}</p>
      <small>${fmtTime(job.submission.at)}</small>
    </div>`}
    <form onSubmit=${send}>
      <div class="preset-row">
        ${SUBMISSION_PRESETS.map((preset) => html`<button type="button" key=${preset.label} disabled=${!canSubmit(job) || busy} onClick=${() => setSubmission({ ...preset.body })}>${preset.label}</button>`)}
      </div>
      <${Field} label="Public URL"><input value=${submission.url} onInput=${set('url')} disabled=${!canSubmit(job) || busy} /><//>
      <${Field} label="Repository"><input value=${submission.repo} onInput=${set('repo')} disabled=${!canSubmit(job) || busy} /><//>
      <${Field} label="Build notes"><textarea rows="4" value=${submission.notes} onInput=${set('notes')} disabled=${!canSubmit(job) || busy} /><//>
      <button disabled=${!canSubmit(job) || busy}>Submit work</button>
    </form>
  </section>`
}

function EscrowPanel({ job, onReview, onDispute, onRefund, busy }) {
  const [note, setNote] = useState('')
  const dispute = (event) => {
    event.preventDefault()
    if (!note.trim()) return
    onDispute(note).then(() => setNote(''))
  }
  return html`<section class="panel escrow-panel">
    <div class="panel-head">
      <h2>Escrow Agent</h2>
      ${job ? html`<${StatusBadge} status=${job.status} />` : html`<span class="mini">Idle</span>`}
    </div>
    ${job ? html`
      <div class="summary">
        <h3>${job.title}</h3>
        <p>${job.requirements}</p>
        <small>${job.acceptanceCriteria}</small>
      </div>
      <div class="ledger">
        <${LinkLine} label="Reference" text=${shortAddr(job.reference)} />
        <${LinkLine} label="Escrow" text=${job.settlement?.escrow || '--'} />
        <${LinkLine} label="Release" text=${job.settlement?.release || '--'} />
        <${LinkLine} label="Refund" text=${job.settlement?.refund || '--'} />
      </div>
      <${QuoteBreakdown} amountSol=${job.amountSol} />
      <div class="actions">
        <button class="primary" onClick=${onReview} disabled=${!canReview(job) || busy}>Review and settle</button>
        <form onSubmit=${dispute}>
          <input value=${note} onInput=${(event) => setNote(event.target.value)} placeholder="Dispute note" disabled=${!job || busy} />
          <button disabled=${!job || busy}>Dispute</button>
        </form>
        <button onClick=${onRefund} disabled=${!canRefund(job) || busy}>Refund</button>
      </div>
    ` : html`<p class="muted">Create a task to open escrow.</p>`}
  </section>`
}

function WalletPanel({ state, job }) {
  const wallets = state?.setup?.wallets || {}
  return html`<section class="panel wallet-panel">
    <div class="panel-head">
      <h2>Wallets</h2>
      <span class="mini">${state?.setup?.mode || 'local-demo'}</span>
    </div>
    <div class="wallet-row"><span>employer</span><b>${wallets.configured ? 'ready' : '--'}</b><code>${shortAddr(wallets.employer)}</code></div>
    <div class="wallet-row"><span>worker</span><b>${wallets.configured ? 'ready' : '--'}</b><code>${shortAddr(wallets.worker)}</code></div>
    <div class="wallet-row"><span>escrow</span><b>local</b><code>${shortAddr(job?.settlement?.escrow)}</code></div>
    <p class="muted">${state?.setup?.note}</p>
  </section>`
}

function ReviewPanel({ job }) {
  const review = job?.review
  return html`<section class="panel review-panel">
    <div class="panel-head">
      <h2>Decision</h2>
      <span class="mini">${review ? `${review.score}/100` : 'No review'}</span>
    </div>
    ${review ? html`
      <div class=${review.approved ? 'decision approved' : 'decision rejected'}>
        <b>${review.approved ? 'Approved for release' : 'Not approved'}</b>
        <p>${review.summary}</p>
      </div>
      <div class="missing">
        <span>Missing</span>
        ${(review.missing || []).length ? html`<ul>${review.missing.map((item) => html`<li key=${item}>${item}</li>`)}</ul>` : html`<p>None recorded.</p>`}
      </div>
    ` : html`<p class="muted">The agent decision appears after worker submission.</p>`}
    <div class="events">
      <span>Audit trail</span>
      ${(job?.events || []).map((event, index) => html`<div class="event-row" key=${index}>
        <b>${event.type.replaceAll('_', ' ')}</b>
        <p>${event.summary}</p>
        <small>${event.actor} - ${fmtTime(event.at)}</small>
      </div>`)}
    </div>
  </section>`
}

function App() {
  const [state, setState] = useState({ jobs: [], setup: { wallets: {}, note: '' } })
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const jobs = useMemo(() => state.jobs || [], [state.jobs])
  const selected = jobs.find((job) => job.id === selectedId) || jobs[0] || null

  async function load() {
    const data = await api('/api/state')
    setState(data)
    if (!selectedId && data.jobs?.[0]) setSelectedId(data.jobs[0].id)
  }

  async function mutate(path, body) {
    setBusy(true)
    setError('')
    try {
      const data = await api(path, body)
      setState(data)
      if (data.jobs?.[0] && (!selectedId || path === '/api/jobs')) setSelectedId(data.jobs[0].id)
      return data
    } catch (err) {
      setError(err.message || String(err))
      throw err
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { load().catch((err) => setError(err.message || String(err))) }, [])

  return html`<>
    <header class="topbar">
      <div>
        <span class="eyebrow">Local demo</span>
        <h1>Freelance Escrow Agent</h1>
      </div>
      <div class="top-links">
        <a class="api-pill" href="./">Current UI</a>
        <div class="api-pill">${API}</div>
      </div>
    </header>
    <main>
      ${error && html`<div class="toast">${error}</div>`}
      <${FlowStrip} job=${selected} />
      <div class="layout">
        <div class="left-col">
          <${Composer} busy=${busy} onCreate=${(draft) => mutate('/api/jobs', draft)} />
          <${JobList} jobs=${jobs} selected=${selected} onSelect=${setSelectedId} onSeed=${() => mutate('/api/demo/seed', {})} />
        </div>
        <div class="middle-col">
          <${ChatPanel} job=${selected} busy=${busy} onMessage=${(body) => mutate(`/api/jobs/${selected.id}/messages`, body)} />
          <${SubmissionPanel} job=${selected} busy=${busy} onSubmitDelivery=${(body) => mutate(`/api/jobs/${selected.id}/submission`, body)} />
        </div>
        <div class="right-col">
          <${EscrowPanel} job=${selected} busy=${busy}
            onReview=${() => mutate(`/api/jobs/${selected.id}/review`, {})}
            onDispute=${(note) => mutate(`/api/jobs/${selected.id}/dispute`, { note })}
            onRefund=${() => mutate(`/api/jobs/${selected.id}/refund`, {})} />
          <${WalletPanel} state=${state} job=${selected} />
          <${ReviewPanel} job=${selected} />
        </div>
      </div>
    </main>
  </>`
}

createRoot(document.getElementById('root')).render(html`<${App} />`)
