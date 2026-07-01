import React, { useEffect, useMemo, useState } from 'https://esm.sh/react@18.3.1'
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client'
import htm from 'https://esm.sh/htm@3.1.1'

const html = htm.bind(React.createElement)
const API = window.FREELANCE_API ?? window.FREELANCE_ESCROW_API ?? 'http://localhost:8801'
const tabs = ['employer', 'worker', 'review', 'escrow', 'operations']

async function api(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: body == null ? 'GET' : 'POST',
    headers: body == null ? undefined : { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

function Badge({ status }) {
  return html`<span class=${`badge ${status}`}>${String(status || 'none').replace(/_/g, ' ')}</span>`
}

function short(value) {
  return value ? `${String(value).slice(0, 6)}...${String(value).slice(-4)}` : 'not generated'
}

function money(value) {
  return `${Number(value || 0).toFixed(3)} SOL`
}

function Shell({ data, selected, setSelected, tab, setTab, refresh, children }) {
  const jobs = data.jobs || []
  const total = jobs.reduce((sum, job) => sum + Number(job.amountSol || 0), 0)
  return html`<div class="app">
    <header class="topbar">
      <div>
        <p class="eyebrow">Solana CoralOS backbone</p>
        <h1>Freelance Escrow Agent</h1>
      </div>
      <div class="top-actions">
        <span class=${data.setup?.wallets?.configured ? 'pill ok' : 'pill warn'}>${data.setup?.wallets?.configured ? 'wallets ready' : 'clean checkout'}</span>
        <a class="page-link" href="./legacy.html">Old UI</a>
        <button class="secondary" onClick=${refresh}>Refresh</button>
      </div>
    </header>

    <section class="status-strip">
      <div><span>Open jobs</span><b>${jobs.length}</b></div>
      <div><span>Total budget</span><b>${money(total)}</b></div>
      <div><span>Employer</span><b>${short(data.setup?.wallets?.employer)}</b></div>
      <div><span>Worker</span><b>${short(data.setup?.wallets?.worker)}</b></div>
    </section>

    <main class="layout">
      <aside class="queue">
        <div class="queue-head">
          <b>Job queue</b>
          <button class="tiny" onClick=${async () => { await api('/api/demo/seed', {}); await refresh() }}>Seed</button>
        </div>
        ${jobs.map((job) => html`<button key=${job.id} class=${`queue-item ${selected?.id === job.id ? 'on' : ''}`} onClick=${() => setSelected(job.id)}>
          <span>${job.title}</span>
          <${Badge} status=${job.status} />
          <small>${money(job.amountSol)} - ${short(job.reference)}</small>
        </button>`)}
        ${!jobs.length && html`<p class="empty">No jobs yet. Create one or seed the demo.</p>`}
      </aside>

      <section class="workspace">
        <div class="job-hero">
          <div>
            <p class="eyebrow">${selected ? `Reference ${short(selected.reference)}` : 'No job selected'}</p>
            <h2>${selected?.title || 'Create or seed a freelance job'}</h2>
          </div>
          ${selected && html`<div class="hero-meta"><${Badge} status=${selected.status} /><b>${money(selected.amountSol)}</b></div>`}
        </div>
        <nav class="tabs">
          ${tabs.map((name) => html`<button class=${tab === name ? 'on' : ''} onClick=${() => setTab(name)}>${name}</button>`)}
        </nav>
        ${children}
      </section>
    </main>
  </div>`
}

function Employer({ job, refresh }) {
  const [form, setForm] = useState({
    title: 'Build a landing page checkout section',
    requirements: 'Responsive layout, clear pricing, accessible buttons, and deployment notes.',
    acceptanceCriteria: 'Includes preview URL, repo link, mobile proof, and notes for each acceptance item.',
    amountSol: 0.001,
  })
  const [message, setMessage] = useState('')
  const [err, setErr] = useState('')
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })
  return html`<div class="grid two">
    <form class="panel" onSubmit=${async (e) => {
      e.preventDefault()
      setErr('')
      try { await api('/api/jobs', form); await refresh() } catch (x) { setErr(x.message) }
    }}>
      <div class="panel-title"><h3>Create job</h3><span>Employer</span></div>
      <label>Task title<input value=${form.title} onInput=${set('title')} /></label>
      <label>Requirements<textarea value=${form.requirements} onInput=${set('requirements')} /></label>
      <label>Acceptance criteria<textarea value=${form.acceptanceCriteria} onInput=${set('acceptanceCriteria')} /></label>
      <label>Budget<input type="number" min="0.001" step="0.001" value=${form.amountSol} onInput=${set('amountSol')} /></label>
      <button>Create funded demo escrow</button>
      ${err && html`<p class="err">${err}</p>`}
    </form>
    <section class="panel">
      <div class="panel-title"><h3>Employer notes</h3><span>${job ? 'selected job' : 'waiting'}</span></div>
      ${job ? html`
        <p class="body-copy">${job.requirements}</p>
        <label>Message worker<input value=${message} onInput=${(e) => setMessage(e.target.value)} placeholder="Clarify scope, deadline, or acceptance details" /></label>
        <button class="secondary" onClick=${async () => {
          if (!message.trim()) return
          await api(`/api/jobs/${job.id}/messages`, { author: 'employer', text: message })
          setMessage('')
          await refresh()
        }}>Send message</button>
      ` : html`<p class="muted">Select a job to message the worker.</p>`}
    </section>
  </div>`
}

function Worker({ job, refresh }) {
  const [message, setMessage] = useState('')
  const [submission, setSubmission] = useState({ url: '', repo: '', notes: '' })
  if (!job) return html`<section class="panel muted">Select a job first.</section>`
  return html`<div class="grid two">
    <section class="panel">
      <div class="panel-title"><h3>Thread</h3><span>${job.messages.length} messages</span></div>
      <div class="thread">
        ${job.messages.map((msg, i) => html`<p key=${i} class=${`msg ${msg.author}`}><b>${msg.author}</b><span>${msg.text}</span></p>`)}
        ${!job.messages.length && html`<p class="muted">No messages yet.</p>`}
      </div>
      <div class="inline-form">
        <input value=${message} onInput=${(e) => setMessage(e.target.value)} placeholder="Reply as worker" />
        <button onClick=${async () => {
          if (!message.trim()) return
          await api(`/api/jobs/${job.id}/messages`, { author: 'worker', text: message })
          setMessage('')
          await refresh()
        }}>Send</button>
      </div>
    </section>
    <form class="panel" onSubmit=${async (e) => {
      e.preventDefault()
      await api(`/api/jobs/${job.id}/submission`, submission)
      await refresh()
    }}>
      <div class="panel-title"><h3>Delivery evidence</h3><span>Worker</span></div>
      <label>Preview URL<input value=${submission.url} onInput=${(e) => setSubmission({ ...submission, url: e.target.value })} /></label>
      <label>Repo URL<input value=${submission.repo} onInput=${(e) => setSubmission({ ...submission, repo: e.target.value })} /></label>
      <label>Notes<textarea value=${submission.notes} onInput=${(e) => setSubmission({ ...submission, notes: e.target.value })} /></label>
      <button>Submit evidence</button>
    </form>
  </div>`
}

function Review({ job, refresh }) {
  if (!job) return html`<section class="panel muted">Select a job first.</section>`
  return html`<div class="grid two">
    <section class="panel">
      <div class="panel-title"><h3>Submission</h3><span>${job.submission ? 'ready' : 'missing'}</span></div>
      ${job.submission ? html`
        <div class="evidence-links">
          <a href=${job.submission.url || '#'} target="_blank">Preview</a>
          <a href=${job.submission.repo || '#'} target="_blank">Repo</a>
        </div>
        <p class="body-copy">${job.submission.notes}</p>
      ` : html`<p class="muted">Worker has not submitted evidence yet.</p>`}
    </section>
    <section class="panel">
      <div class="panel-title"><h3>Review result</h3><${Badge} status=${job.status} /></div>
      ${job.review ? html`
        <div class="score"><b>${job.review.score}</b><span>/ 100</span></div>
        <p>${job.review.summary}</p>
        ${job.review.missing.length ? html`<p class="muted">Missing: ${job.review.missing.join(', ')}</p>` : null}
      ` : html`<p class="muted">Run review after worker submission.</p>`}
      <div class="actions">
        <button onClick=${async () => { await api(`/api/jobs/${job.id}/review`, {}); await refresh() }}>Review and settle</button>
        <button class="secondary" onClick=${async () => { await api(`/api/jobs/${job.id}/dispute`, { note: 'Needs more proof.' }); await refresh() }}>Dispute</button>
      </div>
    </section>
  </div>`
}

function Escrow({ job, refresh }) {
  if (!job) return html`<section class="panel muted">Select a job first.</section>`
  return html`<div class="grid two">
    <section class="panel">
      <div class="panel-title"><h3>Escrow</h3><span>${job.settlement.mode}</span></div>
      <div class="kv">
        <span>Reference</span><b>${job.reference}</b>
        <span>Escrow</span><b>${job.settlement.escrow}</b>
        <span>Release</span><b>${job.settlement.release || '-'}</b>
        <span>Refund</span><b>${job.settlement.refund || '-'}</b>
      </div>
    </section>
    <section class="panel">
      <div class="panel-title"><h3>Settlement actions</h3><${Badge} status=${job.status} /></div>
      <p class="body-copy">Local demo escrow mirrors the workflow without preserving old keys or deployment config.</p>
      <div class="actions">
        <button class="secondary" onClick=${async () => { await api(`/api/jobs/${job.id}/refund`, {}); await refresh() }}>Refund</button>
        <button class="secondary" onClick=${async () => { await api(`/api/jobs/${job.id}/cancel`, {}); await refresh() }}>Cancel</button>
      </div>
    </section>
  </div>`
}

function Operations({ data, refresh }) {
  const [diagnostics, setDiagnostics] = useState(null)
  const [importText, setImportText] = useState('')
  return html`<div class="grid two">
    <section class="panel">
      <div class="panel-title"><h3>Operations</h3><span>${data.setup?.mode}</span></div>
      <p class="body-copy">${data.setup?.note}</p>
      <div class="actions wrap">
        <button onClick=${async () => { await api('/api/demo/seed', {}); await refresh() }}>Seed demo</button>
        <button class="secondary" onClick=${async () => { await api('/api/state/reset', {}); await refresh() }}>Reset jobs</button>
        <button class="secondary" onClick=${async () => {
          const payload = await api('/api/export')
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = 'freelance-escrow-export.json'
          a.click()
          URL.revokeObjectURL(a.href)
        }}>Export</button>
        <button class="secondary" onClick=${async () => setDiagnostics(await api('/api/health'))}>Diagnostics</button>
      </div>
      ${diagnostics && html`<pre>${JSON.stringify(diagnostics, null, 2)}</pre>`}
    </section>
    <section class="panel">
      <div class="panel-title"><h3>Import</h3><span>JSON</span></div>
      <textarea value=${importText} onInput=${(e) => setImportText(e.target.value)} placeholder="Paste an export JSON blob here" />
      <button class="secondary" onClick=${async () => {
        if (!importText.trim()) return
        await api('/api/import', JSON.parse(importText))
        setImportText('')
        await refresh()
      }}>Import jobs</button>
    </section>
  </div>`
}

function Timeline({ job }) {
  return html`<section class="panel timeline">
    <div class="panel-title"><h3>Audit trail</h3><span>${job?.events?.length || 0}</span></div>
    ${job?.events?.map((event, i) => html`<p key=${i}><b>${event.actor}</b><span>${event.summary}</span><small>${new Date(event.at).toLocaleTimeString()}</small></p>`)}
    ${!job && html`<p class="muted">No selected job.</p>`}
  </section>`
}

function App() {
  const [data, setData] = useState({ jobs: [], setup: { wallets: {}, note: '' } })
  const [selectedId, setSelected] = useState('')
  const [tab, setTab] = useState('employer')
  const refresh = async () => {
    const next = await api('/api/state')
    setData(next)
    if (!selectedId && next.jobs[0]) setSelected(next.jobs[0].id)
  }
  useEffect(() => { refresh() }, [])
  const selected = useMemo(() => data.jobs.find((job) => job.id === selectedId) || data.jobs[0], [data.jobs, selectedId])
  const content = tab === 'employer' ? html`<${Employer} job=${selected} refresh=${refresh} />`
    : tab === 'worker' ? html`<${Worker} job=${selected} refresh=${refresh} />`
    : tab === 'review' ? html`<${Review} job=${selected} refresh=${refresh} />`
    : tab === 'escrow' ? html`<${Escrow} job=${selected} refresh=${refresh} />`
    : html`<${Operations} data=${data} refresh=${refresh} />`

  return html`<${Shell} data=${data} selected=${selected} setSelected=${setSelected} tab=${tab} setTab=${setTab} refresh=${refresh}>
    ${content}
    <${Timeline} job=${selected} />
  </${Shell}>`
}

createRoot(document.getElementById('root')).render(html`<${App} />`)
