import React, { useEffect, useState } from 'react'
import { Bot, CheckCircle2, Play, RefreshCw, RotateCcw, Wallet, X } from 'lucide-react'
import { EMPTY_MCP_SESSION } from '../config.js'
import { copyText, short, stopBubble } from '../client.js'
import { agentPrompt, jobBudget, reviewLabel } from '../jobs.js'

function panelWaitingState(job, review) {
  const opinions = review?.panel?.opinions || []
  if (!job?.submission) return 'Waiting for worker delivery evidence.'
  if (!review?.artifactRun) return 'Collecting artifacts, preview checks, and screenshots.'
  if (!review?.panel?.threadId) return 'Opening the Coral review thread.'
  if (opinions.length < 2) return `Waiting for advocate opinions (${opinions.length}/2).`
  if (!review?.panel?.verdict) return 'Waiting for referee verdict.'
  if (!job?.settlement?.release && !job?.settlement?.refund) return 'Verdict received. Settlement is pending.'
  return 'Settlement complete.'
}

function WalletBalances({ wallets, job, titleId }) {
  if (!wallets) return null
  const balance = (value) => typeof value === 'number' && Number.isFinite(value) ? `${value.toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL` : '--'
  const settled = Boolean(job?.settlement?.release || job?.settlement?.refund || job?.status === 'released' || job?.status === 'refunded')
  return (
    <div className="system-wallet-balances">
      <b id={titleId}>{settled ? 'Wallet balances after settlement' : 'Wallet balances'}</b>
      <dl>
        <div><dt>Employer</dt><dd>{balance(wallets.balances?.employerSol)}<small>{short(wallets.employer)}</small></dd></div>
        <div><dt>Worker</dt><dd>{balance(wallets.balances?.workerSol)}<small>{short(wallets.worker)}</small></dd></div>
      </dl>
    </div>
  )
}

function WalletBalanceModal({ open, wallets, job, onClose }) {
  if (!open || !wallets) return null
  return (
    <div className="system-modal-backdrop" onPointerDown={stopBubble} onMouseDown={stopBubble} onClick={stopBubble} onWheel={stopBubble}>
      <section className="system-balance-window" role="dialog" aria-modal="true" aria-labelledby="system-balance-title">
        <button className="system-modal-close" type="button" onClick={onClose} title="Close balances"><X size={17} /></button>
        <WalletBalances wallets={wallets} job={job} titleId="system-balance-title" />
      </section>
    </div>
  )
}

const advocateRoles = [
  ['worker', 'Worker advocate'],
  ['employer', 'Employer advocate'],
]

function AdvocateOutput({ job, review }) {
  const opinions = review?.panel?.opinions || []
  const verdict = review?.panel?.verdict
  const opinionByRole = new Map(opinions.map((opinion) => [opinion.role, opinion]))
  const waiting = !opinions.length && !verdict
  return (
    <div className={`system-advocate-output ${waiting ? 'muted' : ''}`}>
      {waiting ? (
        <div className="system-waiting-row" aria-live="polite">
          <i aria-hidden="true" />
          <span><b>Review in progress</b>{panelWaitingState(job, review)}</span>
        </div>
      ) : null}
      {advocateRoles.map(([role, label]) => {
        const opinion = opinionByRole.get(role)
        return (
          <article key={role} className={opinion ? '' : 'pending'}>
            <b>{label}</b>
            <span>{opinion ? `${opinion.recommendation || 'opinion'} \u00b7 ${opinion.summary || opinion.agent || ''}` : 'Waiting for live advocate output.'}</span>
            {opinion?.concerns?.length ? <small>Concerns: {opinion.concerns.join('; ')}</small> : null}
            {opinion?.evidence?.length ? <small>Evidence: {opinion.evidence.join('; ')}</small> : null}
          </article>
        )
      })}
      {verdict ? (
        <article className="referee">
          <b>Referee</b>
          <span>{verdict.recommendation || review?.recommendation || 'verdict'} {'\u00b7'} {verdict.summary || review?.summary || ''}</span>
        </article>
      ) : (
        <article className="referee pending">
          <b>Referee</b>
          <span>{opinions.length < 2 ? `Waiting for both advocate opinions (${opinions.length}/2).` : 'Both advocate opinions received; waiting for verdict.'}</span>
        </article>
      )}
      {waiting ? <div className="system-waiting-bars" aria-hidden="true"><i /><i /><i /></div> : null}
    </div>
  )
}

export function DemoGuidePanel({
  steps,
  activeStep,
  draft,
  job,
  backendJob,
  panelJob,
  mcpSession,
  wallets,
  busy,
  error,
  onDraft,
  onStart,
  onConfirmBrief,
  onPostJob,
  onCreateMcp,
  onRunWorker,
  onRefresh,
}) {
  const complete = steps.every((step) => step.done)
  const [copied, setCopied] = useState(false)
  const [balancesOpen, setBalancesOpen] = useState(false)
  const [shownBalanceKey, setShownBalanceKey] = useState('')
  const panelWorkJob = panelJob || backendJob
  const balanceJob = panelWorkJob || backendJob
  const panelReview = panelWorkJob?.review
  const settled = complete && Boolean(wallets) && Boolean(balanceJob?.settlement?.release || balanceJob?.settlement?.refund || balanceJob?.status === 'released' || balanceJob?.status === 'refunded')
  const balanceKey = settled ? `${balanceJob?.id || 'job'}:${balanceJob?.settlement?.release || balanceJob?.settlement?.refund || balanceJob?.status}` : ''
  const mcpPrompt = agentPrompt(mcpSession || EMPTY_MCP_SESSION, backendJob, job)
  useEffect(() => {
    if (!balanceKey || shownBalanceKey === balanceKey) return
    setShownBalanceKey(balanceKey)
    setBalancesOpen(true)
  }, [balanceKey, shownBalanceKey])
  const copyMcpPrompt = async (event) => {
    event?.preventDefault()
    event?.stopPropagation()
    await copyText(mcpPrompt)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <>
    <WalletBalanceModal open={balancesOpen} wallets={wallets} job={balanceJob} onClose={() => setBalancesOpen(false)} />
    <section className="system-guide-window" onPointerDown={stopBubble} onMouseDown={stopBubble} onClick={stopBubble} onWheel={stopBubble}>
      <div className="system-guide-head">
        <div><span>Demo guide</span><b>{complete ? 'Complete' : activeStep?.title || 'Ready'}</b></div>
        <button onClick={onRefresh} title="Refresh demo state"><RefreshCw size={15} /></button>
      </div>
      <div className="system-guide-dots" aria-hidden="true">
        {steps.map((step) => <i key={step.id} className={step.done ? 'done' : activeStep?.id === step.id ? 'active' : ''}>{step.index}</i>)}
      </div>
      <p>{complete ? 'The guided demo has enough evidence for the panel.' : activeStep.detail}</p>
      {activeStep.id === 'brief' ? (
        <div className="system-guide-fields">
          <label><span>Employer</span><input value={draft.employer} onInput={onDraft('employer')} /></label>
          <label><span>Title</span><input value={draft.title} onInput={onDraft('title')} /></label>
          <label><span>Budget SOL</span><input type="number" min="0.001" step="0.0001" value={draft.budgetSol} onInput={onDraft('budgetSol')} /></label>
          <label><span>Scope</span><textarea rows="3" value={draft.scope} onInput={onDraft('scope')} /></label>
          <label><span>Acceptance criteria</span><textarea rows="3" value={draft.acceptanceCriteria} onInput={onDraft('acceptanceCriteria')} /></label>
        </div>
      ) : null}
      {activeStep.id === 'post' ? (
        <dl className="system-guide-summary">
          <div><dt>Job</dt><dd>{job.title}</dd></div>
          <div><dt>Budget</dt><dd>{jobBudget(job)}</dd></div>
          <div><dt>Scope</dt><dd>{job.scope}</dd></div>
        </dl>
      ) : null}
      {activeStep.id === 'agent' ? (
        <div className="system-guide-choice">
          <b>{mcpSession?.authorizationHeader ? 'AI agent MCP setup' : 'Choose how the worker acts'}</b>
          <span>
            {mcpSession?.authorizationHeader
              ? 'Copy this prompt into Codex, OpenClaw, or any MCP-capable agent. It contains the MCP URL, auth header, job id, max bid, required tool calls, and reviewMode.'
              : 'Create an MCP setup for an external agent, or run the bundled local worker.'}
          </span>
          {mcpSession?.authorizationHeader ? <pre className="system-guide-prompt">{mcpPrompt}</pre> : null}
        </div>
      ) : null}
      {activeStep.id === 'delivery' || activeStep.id === 'panel' ? (
        <dl className="system-guide-summary">
          <div><dt>Backend job</dt><dd>{(backendJob || panelWorkJob)?.id || '--'}</dd></div>
          <div><dt>Status</dt><dd>{(backendJob || panelWorkJob)?.status || '--'}</dd></div>
          <div><dt>Review</dt><dd>{reviewLabel((backendJob || panelWorkJob)?.review)}</dd></div>
        </dl>
      ) : null}
      {activeStep.id === 'panel' || panelReview?.panel?.opinions?.length ? <AdvocateOutput job={panelWorkJob} review={panelReview} /> : null}
      <div className="system-guide-actions">
        {activeStep.id === 'start' ? <button type="button" onClick={onStart} disabled={busy}><RotateCcw size={15} />{busy ? 'Starting' : 'Start clean demo'}</button> : null}
        {activeStep.id === 'brief' ? <button type="button" onClick={onConfirmBrief} disabled={busy}><CheckCircle2 size={15} />Use this brief</button> : null}
        {activeStep.id === 'post' ? <button type="button" onClick={onPostJob} disabled={busy}><CheckCircle2 size={15} />Post real job</button> : null}
        {activeStep.id === 'agent' && !mcpSession?.authorizationHeader ? <button type="button" onClick={onCreateMcp} disabled={busy}><Bot size={15} />AI agent setup</button> : null}
        {activeStep.id === 'agent' && mcpSession?.authorizationHeader ? <button type="button" className="primary" onClick={copyMcpPrompt} disabled={busy}>{copied ? <CheckCircle2 size={15} /> : <Bot size={15} />}{copied ? 'Copied' : 'Copy MCP prompt'}</button> : null}
        {activeStep.id === 'agent' ? <button type="button" className="secondary" onClick={onRunWorker} disabled={busy}><Play size={15} />Bundled worker</button> : null}
        {activeStep.id === 'delivery' || activeStep.id === 'panel' || complete ? <button type="button" onClick={onRefresh} disabled={busy}><RefreshCw size={15} />Refresh</button> : null}
        {settled ? <button type="button" onClick={() => setBalancesOpen(true)} disabled={busy}><Wallet size={15} />View balances</button> : null}
        {complete ? <button type="button" onClick={onStart} disabled={busy}><RotateCcw size={15} />Restart demo</button> : null}
      </div>
      {error ? <p className="system-error small">{error}</p> : null}
    </section>
    </>
  )
}
