import React, { useState } from 'react'
import { Bot, CheckCircle2, Play, RefreshCw, RotateCcw } from 'lucide-react'
import { EMPTY_MCP_SESSION } from '../config.js'
import { copyText, stopBubble } from '../client.js'
import { agentPrompt, jobBudget, reviewLabel } from '../jobs.js'

function AdvocateOutput({ review }) {
  const opinions = review?.panel?.opinions || []
  const verdict = review?.panel?.verdict
  if (!opinions.length && !verdict) {
    return (
      <div className="system-advocate-output muted">
        <b>Advocate output</b>
        <span>Waiting for worker and employer advocates.</span>
      </div>
    )
  }
  return (
    <div className="system-advocate-output">
      {opinions.map((opinion) => (
        <article key={opinion.role}>
          <b>{opinion.role === 'worker' ? 'Worker advocate' : 'Employer advocate'}</b>
          <span>{opinion.recommendation || 'opinion'} {'\u00b7'} {opinion.summary || opinion.agent || ''}</span>
          {opinion.concerns?.length ? <small>Concerns: {opinion.concerns.join('; ')}</small> : null}
          {opinion.evidence?.length ? <small>Evidence: {opinion.evidence.join('; ')}</small> : null}
        </article>
      ))}
      {verdict ? (
        <article className="referee">
          <b>Referee</b>
          <span>{verdict.recommendation || review?.recommendation || 'verdict'} {'\u00b7'} {verdict.summary || review?.summary || ''}</span>
        </article>
      ) : null}
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
  const panelReview = (panelJob || backendJob)?.review
  const mcpPrompt = agentPrompt(mcpSession || EMPTY_MCP_SESSION, backendJob, job)
  const copyMcpPrompt = async (event) => {
    event?.preventDefault()
    event?.stopPropagation()
    await copyText(mcpPrompt)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
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
          <div><dt>Backend job</dt><dd>{backendJob?.id || '--'}</dd></div>
          <div><dt>Status</dt><dd>{backendJob?.status || '--'}</dd></div>
          <div><dt>Review</dt><dd>{reviewLabel(backendJob?.review)}</dd></div>
        </dl>
      ) : null}
      {activeStep.id === 'panel' || panelReview?.panel?.opinions?.length ? <AdvocateOutput review={panelReview} /> : null}
      <div className="system-guide-actions">
        {activeStep.id === 'start' ? <button type="button" onClick={onStart} disabled={busy}><RotateCcw size={15} />{busy ? 'Starting' : 'Start clean demo'}</button> : null}
        {activeStep.id === 'brief' ? <button type="button" onClick={onConfirmBrief} disabled={busy}><CheckCircle2 size={15} />Use this brief</button> : null}
        {activeStep.id === 'post' ? <button type="button" onClick={onPostJob} disabled={busy}><CheckCircle2 size={15} />Post real job</button> : null}
        {activeStep.id === 'agent' && !mcpSession?.authorizationHeader ? <button type="button" onClick={onCreateMcp} disabled={busy}><Bot size={15} />AI agent setup</button> : null}
        {activeStep.id === 'agent' && mcpSession?.authorizationHeader ? <button type="button" className="primary" onClick={copyMcpPrompt} disabled={busy}>{copied ? <CheckCircle2 size={15} /> : <Bot size={15} />}{copied ? 'Copied' : 'Copy MCP prompt'}</button> : null}
        {activeStep.id === 'agent' ? <button type="button" className="secondary" onClick={onRunWorker} disabled={busy}><Play size={15} />Bundled worker</button> : null}
        {activeStep.id === 'delivery' || activeStep.id === 'panel' || complete ? <button type="button" onClick={onRefresh} disabled={busy}><RefreshCw size={15} />Refresh</button> : null}
        {complete ? <button type="button" onClick={onStart} disabled={busy}><RotateCcw size={15} />Restart demo</button> : null}
      </div>
      {error ? <p className="system-error small">{error}</p> : null}
    </section>
  )
}
