import React, { useEffect, useMemo, useState } from 'https://esm.sh/react@18.3.1'
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client'
import htm from 'https://esm.sh/htm@3.1.1'

const html = htm.bind(React.createElement)
const API = window.FREELANCE_ESCROW_API ?? 'http://localhost:8801'
const FAUCET_URL = 'https://faucet.solana.com'

const STATUS_LABELS = {
  funding_failed: 'Funding failed',
  funded: 'Funded',
  submitted: 'Submitted',
  approved: 'Approved',
  released: 'Released',
  rejected: 'Rejected',
  disputed: 'Disputed',
  refunded: 'Refunded',
}

const WALLET_LABELS = { configuredArbiter: 'configured arbiter' }

const JOB_PRESETS = [
  {
    label: 'Checkout',
    draft: {
      title: 'Responsive checkout landing page',
      requirements: 'Build a responsive landing page with pricing cards, FAQ section, and contact form.',
      acceptanceCriteria: 'Mobile layout works. Pricing cards, FAQ, and contact form are present. Include a public URL or repo.',
      amountSol: 0.02,
      deadlineSecs: 3600,
    },
  },
  {
    label: 'API docs',
    draft: {
      title: 'Developer API documentation',
      requirements: 'Write endpoint documentation for auth, errors, pagination, and webhook retries.',
      acceptanceCriteria: 'Includes curl examples, setup notes, and a repo or public URL for review.',
      amountSol: 0.01,
      deadlineSecs: 3600,
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

const canSubmit = (job) => job && ['funded', 'submitted', 'rejected', 'disputed'].includes(job.status)
const canReview = (job) => job?.submission && job?.settlement?.open && job.status !== 'approved' && !job.settlement?.release && !job.settlement?.refund
const canRetryFunding = (job) => job?.status === 'funding_failed' && !job.settlement?.open
const canRetryRelease = (job) => job?.status === 'approved' && job?.review?.approved && !job.settlement?.release && !job.settlement?.refund
const canRefund = (job) =>
  job?.deadlinePassed && ['rejected', 'disputed'].includes(job.status) && !job.settlement?.release && !job.settlement?.refund

const shortAddr = (value) => value ? `${String(value).slice(0, 4)}...${String(value).slice(-4)}` : '--'
const fmtSol = (value) => {
  if (typeof value !== 'number') return '--'
  return `${value.toFixed(Math.abs(value) < 0.01 ? 6 : 4)} SOL`
}
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
  return html`<span class=${`status ${status}`}>${STATUS_LABELS[status] || status}</span>`
}

function Field({ label, children }) {
  return html`<label class="field"><span>${label}</span>${children}</label>`
}

function LinkLine({ label, href, text }) {
  return html`
    <div class="link-line">
      <span>${label}</span>
      ${href
        ? html`<a href=${href} target="_blank" rel="noreferrer">${text || 'Explorer'}</a>`
        : html`<b>--</b>`}
    </div>`
}

function QuoteBreakdown({ quote, error }) {
  if (error) return html`<p class="warn">${error}</p>`
  if (!quote) return html`<div class="quote muted">Quote loading...</div>`
  return html`
    <div class="quote">
      <div class="quote-row"><span>Budget</span><b>${fmtSol(quote.amountSol)}</b></div>
      <div class="quote-row"><span>Escrow rent</span><b>${fmtSol(quote.escrowRentSol)}</b></div>
      <div class="quote-row"><span>Arbiter top-up</span><b>${fmtSol(quote.arbiterTopUpSol)}</b></div>
      <div class="quote-row total"><span>Estimated employer debit</span><b>${fmtSol(quote.estimatedDebitSol)}</b></div>
      <p>${quote.explanation}</p>
      <small>${quote.feeNote}</small>
    </div>`
}

function WalletPanel({ state }) {
  const wallets = state?.wallets?.addresses || {}
  const balances = state?.balances || {}
  const errors = state?.wallets?.errors || {}
  return html`
    <section class="panel wallet-panel">
      <div class="panel-head">
        <h2>Wallets</h2>
        <span class="mini">${state?.network?.cluster || 'devnet'}</span>
      </div>
      ${['employer', 'worker', 'arbiter', 'configuredArbiter', 'vault', 'escrow'].map((name) => html`
        <div class="wallet-row" key=${name}>
          <span>${WALLET_LABELS[name] || name}</span>
          <b>${fmtSol(balances[name])}</b>
          <code>${shortAddr(wallets[name] || state?.selectedJob?.settlement?.[name])}</code>
        </div>`)}
      ${Object.values(errors).length > 0 && html`
        <p class="warn">${Object.values(errors)[0]}</p>`}
    </section>`
}

function Composer({ onCreate, busy }) {
  const [draft, setDraft] = useState(JOB_PRESETS[0].draft)
  const [quote, setQuote] = useState(null)
  const [quoteError, setQuoteError] = useState('')
  const set = (key) => (event) => setDraft({ ...draft, [key]: event.target.value })

  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      api('/api/quote', { amountSol: Number(draft.amountSol) })
        .then((data) => { if (alive) { setQuote(data); setQuoteError('') } })
        .catch((err) => { if (alive) setQuoteError(err.message || String(err)) })
    }, 200)
    return () => { alive = false; clearTimeout(timer) }
  }, [draft.amountSol])

  return html`
    <section class="panel composer">
      <div class="panel-head">
        <h2>Employer</h2>
        <span class="mini">Create and fund</span>
      </div>
      <form onSubmit=${(event) => { event.preventDefault(); onCreate(draft) }}>
        <div class="preset-row">
          ${JOB_PRESETS.map((preset) => html`
            <button type="button" key=${preset.label} onClick=${() => setDraft({ ...preset.draft })}>${preset.label}</button>`)}
        </div>
        <${Field} label="Task title">
          <input value=${draft.title} onInput=${set('title')} required />
        <//>
        <${Field} label="Requirements">
          <textarea rows="5" value=${draft.requirements} onInput=${set('requirements')} required />
        <//>
        <${Field} label="Acceptance criteria">
          <textarea rows="4" value=${draft.acceptanceCriteria} onInput=${set('acceptanceCriteria')} />
        <//>
        <div class="form-grid">
          <${Field} label="Budget">
            <input type="number" min="0.001" step="0.001" value=${draft.amountSol} onInput=${set('amountSol')} />
          <//>
          <${Field} label="Deadline">
            <select value=${draft.deadlineSecs} onChange=${set('deadlineSecs')}>
              <option value="600">10 minutes</option>
              <option value="3600">1 hour</option>
              <option value="86400">24 hours</option>
            </select>
          <//>
        </div>
        <${QuoteBreakdown} quote=${quote} error=${quoteError} />
        <button class="primary" disabled=${busy}>Fund escrow</button>
      </form>
    </section>`
}

function JobList({ jobs, selected, onSelect }) {
  return html`
    <section class="panel jobs-panel">
      <div class="panel-head">
        <h2>Jobs</h2>
        <span class="mini">${jobs.length}</span>
      </div>
      <div class="job-list">
        ${jobs.length === 0 && html`<p class="muted">No funded tasks yet.</p>`}
        ${jobs.map((job) => html`
          <button key=${job.id} class=${`job-item ${selected?.id === job.id ? 'active' : ''}`} onClick=${() => onSelect(job.id)}>
            <span>
              <b>${job.title}</b>
              <small>${job.amountSol} SOL - due ${fmtTime(job.deadlineAt)}</small>
            </span>
            <${StatusBadge} status=${job.status} />
          </button>`)}
      </div>
    </section>`
}

function FlowStrip({ job }) {
  const funded = job?.settlement?.open
  const submitted = job?.submission
  const settled = job?.settlement?.release || job?.settlement?.refund
  return html`
    <section class="flow-strip">
      <div class=${funded ? 'flow-node done' : 'flow-node'}>
        <b>1</b><span>Escrow funded</span>
      </div>
      <div class=${submitted ? 'flow-node done' : 'flow-node'}>
        <b>2</b><span>Work submitted</span>
      </div>
      <div class=${settled ? 'flow-node done' : 'flow-node'}>
        <b>3</b><span>Agent settles</span>
      </div>
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
  return html`
    <section class="panel chat-panel">
      <div class="panel-head">
        <h2>Chat</h2>
        <span class="mini">${job?.messages?.length || 0} messages</span>
      </div>
      <div class="timeline">
        ${(job?.messages || []).map((msg) => html`
          <div class=${`msg ${msg.author}`} key=${msg.id}>
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
  return html`
    <section class="panel submission-panel">
      <div class="panel-head">
        <h2>Worker</h2>
        <span class="mini">${job?.submission ? 'Evidence submitted' : 'Delivery'}</span>
      </div>
      ${job?.submission && html`
        <div class="evidence">
          <${LinkLine} label="URL" href=${job.submission.url} text=${job.submission.url} />
          <${LinkLine} label="Repo" href=${job.submission.repo} text=${job.submission.repo} />
          <p>${job.submission.notes || '--'}</p>
          <small>${fmtTime(job.submission.at)}</small>
        </div>`}
      <form onSubmit=${send}>
        <div class="preset-row">
          ${SUBMISSION_PRESETS.map((preset) => html`
            <button
              type="button"
              key=${preset.label}
              disabled=${!canSubmit(job) || busy}
              onClick=${() => setSubmission({ ...preset.body })}
            >${preset.label}</button>`)}
        </div>
        <${Field} label="Public URL">
          <input value=${submission.url} onInput=${set('url')} disabled=${!canSubmit(job) || busy} />
        <//>
        <${Field} label="Repository">
          <input value=${submission.repo} onInput=${set('repo')} disabled=${!canSubmit(job) || busy} />
        <//>
        <${Field} label="Build notes">
          <textarea rows="4" value=${submission.notes} onInput=${set('notes')} disabled=${!canSubmit(job) || busy} />
        <//>
        <button disabled=${!canSubmit(job) || busy}>Submit work</button>
      </form>
    </section>`
}

function EscrowPanel({ job, state, onFund, onReview, onRelease, onDispute, onRefund, busy }) {
  const [note, setNote] = useState('')
  const employer = state?.wallets?.addresses?.employer
  const dispute = (event) => {
    event.preventDefault()
    if (!note.trim()) return
    onDispute(note).then(() => setNote(''))
  }
  return html`
    <section class="panel escrow-panel">
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
          <${LinkLine} label="Reference" href=${job.links?.reference} text=${shortAddr(job.reference)} />
          <${LinkLine} label="Open" href=${job.links?.open} text=${job.settlement?.open?.sig ? shortAddr(job.settlement.open.sig) : ''} />
          <${LinkLine} label="Release" href=${job.links?.release} text=${job.settlement?.release?.sig ? shortAddr(job.settlement.release.sig) : ''} />
          <${LinkLine} label="Refund" href=${job.links?.refund} text=${job.settlement?.refund?.sig ? shortAddr(job.settlement.refund.sig) : ''} />
          <${LinkLine} label="Vault" href=${job.links?.vault} text=${shortAddr(job.settlement?.vault)} />
          <${LinkLine} label="Escrow PDA" href=${job.links?.escrow} text=${shortAddr(job.settlement?.escrow)} />
        </div>
        <${QuoteBreakdown} quote=${job.fundingQuote} />
        ${canRetryFunding(job) && html`
          <div class="guide funding-guide">
            <b>Escrow is not funded yet.</b>
            <p>Fund the employer wallet with devnet SOL, then retry funding this same job.</p>
            <${LinkLine} label="Employer" href=${employer ? `https://explorer.solana.com/address/${employer}?cluster=devnet` : ''} text=${employer || ''} />
            <a href=${FAUCET_URL} target="_blank" rel="noreferrer">Open devnet faucet</a>
          </div>`}
        ${canRetryRelease(job) && html`
          <div class="guide release-guide">
            <b>Approved, release still pending.</b>
            <p>The review decision is saved. Retry only the on-chain release.</p>
          </div>`}
        ${job.settlement?.error && html`<p class="warn">${job.settlement.error}</p>`}
        <div class="actions">
          ${canRetryFunding(job)
            ? html`<button class="primary" onClick=${onFund} disabled=${busy}>Retry funding</button>`
            : canRetryRelease(job)
              ? html`<button class="primary" onClick=${onRelease} disabled=${busy}>Retry release</button>`
              : html`<button class="primary" onClick=${onReview} disabled=${!canReview(job) || busy}>Review and settle</button>`}
          <form onSubmit=${dispute}>
            <input value=${note} onInput=${(event) => setNote(event.target.value)} placeholder="Dispute note" disabled=${!job || busy} />
            <button disabled=${!job || busy}>Dispute</button>
          </form>
          <button onClick=${onRefund} disabled=${!canRefund(job) || busy}>Refund after deadline</button>
        </div>
      ` : html`<p class="muted">Create a task to open escrow.</p>`}
    </section>`
}

function CriteriaList({ criteria }) {
  if (!criteria?.length) return null
  return html`
    <div class="criteria-list">
      <span>Criteria</span>
      ${criteria.map((criterion, index) => html`
        <div class=${`criterion ${criterion.verdict}`} key=${`${index}-${criterion.text}`}>
          <div>
            <b>${criterion.text}</b>
            <small>${criterion.evidence || criterion.missing || 'No evidence recorded.'}</small>
          </div>
          <strong>${criterion.score}/100</strong>
        </div>`)}
    </div>`
}

function ReviewHistory({ reviews }) {
  if (!reviews?.length) return null
  return html`
    <div class="history">
      <span>Review history</span>
      ${reviews.slice().reverse().map((review, index) => html`
        <div class="history-row" key=${`${index}-${review.score}-${review.summary}`}>
          <b>${review.approved ? 'Approved' : 'Rejected'}</b>
          <span>${review.score}/100 - confidence ${Math.round((review.confidence || 0) * 100)}%</span>
          <p>${review.summary}</p>
        </div>`)}
    </div>`
}

function AuditTrail({ events }) {
  if (!events?.length) return null
  return html`
    <div class="events">
      <span>Audit trail</span>
      ${events.slice().reverse().map((event) => html`
        <div class="event-row" key=${event.id}>
          <b>${event.type.replaceAll('_', ' ')}</b>
          <p>${event.summary}</p>
          <small>${event.actor} - ${fmtTime(event.at)}</small>
        </div>`)}
    </div>`
}

function ReviewPanel({ job }) {
  const review = job?.review
  const reviews = job?.reviews || []
  const disputes = job?.disputes || []
  return html`
    <section class="panel review-panel">
      <div class="panel-head">
        <h2>Decision</h2>
        <span class="mini">${review ? `${review.score}/100` : 'No review'}</span>
      </div>
      ${review ? html`
        <div class=${review.approved ? 'decision approved' : 'decision rejected'}>
          <b>${review.approved ? 'Approved for release' : 'Not approved'}</b>
          <p>${review.summary}</p>
          <p>Confidence ${Math.round((review.confidence || 0) * 100)}%</p>
          <small>${review.releaseReason}</small>
        </div>
        <${CriteriaList} criteria=${review.criteria} />
        <div class="missing">
          <span>Missing</span>
          ${(review.missing || []).length
            ? html`<ul>${review.missing.map((item) => html`<li key=${item}>${item}</li>`)}</ul>`
            : html`<p>None recorded.</p>`}
        </div>
      ` : html`<p class="muted">The agent decision appears after worker submission.</p>`}
      ${disputes.length > 0 && html`
        <div class="disputes">
          <span>Disputes</span>
          ${disputes.map((d) => html`<p key=${d.id}>${d.note}<small>${fmtTime(d.at)}</small></p>`)}
        </div>`}
      <${ReviewHistory} reviews=${reviews} />
      <${AuditTrail} events=${job?.events || []} />
    </section>`
}

function App() {
  const [state, setState] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const selected = state?.selectedJob || null
  const jobs = useMemo(() => [...(state?.jobs || [])].reverse(), [state])

  async function load(id = selectedId) {
    const data = await api(`/api/state${id ? `?jobId=${encodeURIComponent(id)}` : ''}`)
    setState(data)
    if (!selectedId && data.selectedJob) setSelectedId(data.selectedJob.id)
  }

  async function mutate(path, body) {
    setBusy(true)
    setError('')
    try {
      const data = await api(path, body)
      setState(data)
      if (data.selectedJob) setSelectedId(data.selectedJob.id)
      return data
    } catch (err) {
      setError(err.message || String(err))
      throw err
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    let alive = true
    const tick = () => load().catch((err) => { if (alive) setError(err.message || String(err)) })
    tick()
    const timer = setInterval(tick, 6000)
    return () => { alive = false; clearInterval(timer) }
  }, [selectedId])

  const selectJob = (id) => {
    setSelectedId(id)
    load(id).catch((err) => setError(err.message || String(err)))
  }

  return html`
    <header class="topbar">
      <div>
        <span class="eyebrow">Devnet</span>
        <h1>Freelance Escrow Agent</h1>
      </div>
      <div class="api-pill">${API}</div>
    </header>
    <main>
      ${error && html`<div class="toast">${error}</div>`}
      <${FlowStrip} job=${selected} />
      <div class="layout">
        <div class="left-col">
          <${Composer} busy=${busy} onCreate=${(draft) => mutate('/api/jobs', draft)} />
          <${JobList} jobs=${jobs} selected=${selected} onSelect=${selectJob} />
        </div>
        <div class="middle-col">
          <${ChatPanel} job=${selected} busy=${busy}
            onMessage=${(body) => mutate(`/api/jobs/${selected.id}/messages`, body)} />
          <${SubmissionPanel} job=${selected} busy=${busy}
            onSubmitDelivery=${(body) => mutate(`/api/jobs/${selected.id}/submission`, body)} />
        </div>
        <div class="right-col">
          <${EscrowPanel} job=${selected} state=${state} busy=${busy}
            onFund=${() => mutate(`/api/jobs/${selected.id}/fund`, {})}
            onReview=${() => mutate(`/api/jobs/${selected.id}/review`, {})}
            onRelease=${() => mutate(`/api/jobs/${selected.id}/release`, {})}
            onDispute=${(note) => mutate(`/api/jobs/${selected.id}/dispute`, { note })}
            onRefund=${() => mutate(`/api/jobs/${selected.id}/refund`, {})} />
          <${WalletPanel} state=${state} />
          <${ReviewPanel} job=${selected} />
        </div>
      </div>
    </main>
  `
}

createRoot(document.getElementById('root')).render(html`<${App} />`)
