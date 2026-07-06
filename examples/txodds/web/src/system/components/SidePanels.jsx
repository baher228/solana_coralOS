import React, { useState } from 'react'
import { BriefcaseBusiness, ExternalLink, Play, RefreshCw } from 'lucide-react'
import { CORAL_BUS } from '../config.js'
import { copyText } from '../client.js'
import {
  agentPrompt,
  artifactState,
  jobBudget,
  liveSnapshot,
  panelStep,
} from '../jobs.js'

export function ProofList() {
  return (
    <section className="system-proof">
      <span>What this proves</span>
      <ul>
        <li>The platform MCP and Coral MCP bus are separate.</li>
        <li>Bids are permissioned, wallet-backed, and escrow-funded.</li>
        <li>The backend awards automatically.</li>
        <li>Build, test, preview, and screenshots are collected before judging.</li>
        <li>Worker advocate, employer advocate, and referee communicate through Coral.</li>
      </ul>
    </section>
  )
}

export function JobSetup({ job, backendJob, error, active, briefOpen, onToggleBrief }) {
  return (
    <section className={`system-run system-job-setup ${active ? 'guide-active' : ''}`}>
      <div className="system-run-head">
        <div><span>Job description</span><b>{backendJob ? 'Posted to API' : job.title}</b></div>
        <button onClick={onToggleBrief} title={briefOpen ? 'Hide job brief' : 'View job brief'}><BriefcaseBusiness size={15} /></button>
      </div>
      {error ? <p className="system-error small">{error}</p> : null}
      {backendJob ? <p className="system-job-backend">Backend {backendJob.id} {'\u00b7'} {backendJob.status}</p> : null}
      <button className="system-brief-toggle" onClick={onToggleBrief}>
        <BriefcaseBusiness size={15} />{briefOpen ? 'Hide description' : 'View description'}
      </button>
      {briefOpen ? (
        <div className="system-job-brief">
          <b>{backendJob?.title || job.title}</b>
          <dl>
            {backendJob ? <div><dt>Job id</dt><dd>{backendJob.id}</dd></div> : null}
            <div><dt>Employer</dt><dd>{backendJob?.employer || job.employer}</dd></div>
            <div><dt>Budget</dt><dd>{backendJob ? `${backendJob.amountSol} SOL` : jobBudget(job)}</dd></div>
            <div><dt>Scope</dt><dd>{backendJob?.scope || job.scope}</dd></div>
            <div><dt>Acceptance</dt><dd>{backendJob?.acceptanceCriteria || job.acceptanceCriteria}</dd></div>
          </dl>
        </div>
      ) : null}
    </section>
  )
}

export function McpAgentDemo({ session, job, brief, busy, error, active, onStart, onRefresh }) {
  const previewUrl = job?.submission?.url || session.previewUrl
  const prompt = agentPrompt(session, job, brief)
  const [copied, setCopied] = useState(false)
  const copyPrompt = async (event) => {
    event?.preventDefault()
    event?.stopPropagation()
    await copyText(prompt)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }
  const steps = [
    ['Key', session.steps?.registered],
    ['Job', session.steps?.jobPosted || Boolean(job)],
    ['MCP', session.steps?.connected],
    ['Bid', session.steps?.bidPlaced || Boolean(job?.marketplace?.bids?.length)],
    ['Award', session.steps?.awarded || Boolean(job?.marketplace?.awardedBid)],
    ['Escrow', session.steps?.funded || Boolean(job?.settlement?.devnet?.deposit)],
    ['Delivery', session.steps?.deliverySubmitted || Boolean(job?.submission)],
    ['Review', session.steps?.reviewCaptured || Boolean(job?.review)],
  ]
  return (
    <section className={`system-run system-mcp ${active ? 'guide-active' : ''}`}>
      <div className="system-run-head">
        <div><span>AI agent MCP setup</span><b>{session.active ? session.steps?.connected ? 'Connected' : 'Key ready' : 'Needs key'}</b></div>
        <button onClick={onRefresh} title="Refresh MCP demo"><RefreshCw size={15} /></button>
      </div>
      <div className="system-run-actions">
        <button type="button" onClick={onStart} disabled={busy}><Play size={15} />{busy ? 'Creating' : session.active ? 'Show MCP setup' : 'Create MCP setup'}</button>
        <button type="button" onClick={copyPrompt} disabled={!session.authorizationHeader}>{copied ? 'Copied' : 'Copy agent prompt'}</button>
        {previewUrl
          ? <a className="system-run-link" href={previewUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Open agent build</a>
          : <button disabled><ExternalLink size={15} />Open agent build</button>}
      </div>
      <pre className="system-mcp-setup">{prompt}</pre>
      <div className="system-run-steps">
        {steps.map(([label, done]) => <span key={label} className={done ? 'done' : ''}>{label}</span>)}
      </div>
      <dl>
        <div><dt>Job</dt><dd>{job?.title || session.jobId || '--'}</dd></div>
        <div><dt>Status</dt><dd>{job?.status || '--'}</dd></div>
        <div><dt>Agent</dt><dd>{session.agentName || '--'}</dd></div>
        <div><dt>Last MCP call</dt><dd>{session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleTimeString() : '--'}</dd></div>
      </dl>
      {error || session.error ? <p className="system-error small">{error || session.error}</p> : null}
      {session.events?.length ? (
        <div className="system-run-log">
          {session.events.slice(0, 5).map((line) => <small key={line}>{line}</small>)}
        </div>
      ) : null}
    </section>
  )
}

export function LiveFacts({ data, enabled, error }) {
  const { job, agents } = liveSnapshot(data)
  return (
    <section className="system-live">
      <div><span>Read-only live data</span><b>{enabled ? 'On' : 'Off'}</b></div>
      {error ? <p className="system-error small">{error}</p> : null}
      <dl>
        <div><dt>Latest job</dt><dd>{job?.title || 'No job loaded'}</dd></div>
        <div><dt>Status</dt><dd>{job?.status || '--'}</dd></div>
        <div><dt>Awarded</dt><dd>{job?.marketplace?.awardedBid?.by || '--'}</dd></div>
        <div><dt>Review panel</dt><dd>{panelStep(job?.review)}</dd></div>
        <div><dt>Connected agents</dt><dd>{agents.filter((agent) => agent.status === 'active').length}</dd></div>
      </dl>
    </section>
  )
}

const panelOpinionRoles = [
  ['worker', 'Worker advocate'],
  ['employer', 'Employer advocate'],
]

export function CoralPanelStatus({ job, bus, error, active, onRefresh }) {
  const review = job?.review
  const run = review?.artifactRun
  const panel = review?.panel
  const hasPanel = Boolean(panel)
  const opinions = panel?.opinions || []
  const verdict = panel?.verdict
  const opinionByRole = new Map(opinions.map((opinion) => [opinion.role, opinion]))
  const busOnline = Boolean(bus?.ok)

  return (
    <section className={`system-run system-coral ${active ? 'guide-active' : ''}`}>
      <div className="system-run-head">
        <div><span>Coral panel review</span><b>{busOnline ? 'Bus online' : 'Bus offline'}</b></div>
        <button onClick={onRefresh} title="Refresh Coral bus"><RefreshCw size={15} /></button>
      </div>
      {error ? <p className="system-error small">{error}</p> : null}
      <div className="system-coral-bus">
        <span>{CORAL_BUS}/mcp</span>
        <b>{busOnline ? `${bus.threads || 0} threads \u00b7 ${bus.messages || 0} messages` : 'not connected'}</b>
      </div>
      <div className="system-run-steps">
        {[
          ['Artifacts', Boolean(run)],
          ['Thread', !review || !hasPanel ? false : Boolean(panel?.threadId)],
          ['Worker', !review || !hasPanel ? Boolean(review?.releaseEligible) : opinions.some((item) => item.role === 'worker')],
          ['Employer', !review || !hasPanel ? Boolean(review?.releaseEligible) : opinions.some((item) => item.role === 'employer')],
          ['Referee', !review || !hasPanel ? Boolean(review?.recommendation) : Boolean(verdict)],
          ['Gate', Boolean(review?.releaseEligible)],
        ].map(([label, done]) => <span key={label} className={done ? 'done' : ''}>{label}</span>)}
      </div>
      <dl>
        <div><dt>Latest Coral job</dt><dd>{job?.title || 'Waiting for Coral-reviewed delivery'}</dd></div>
        <div><dt>Panel state</dt><dd>{panelStep(review)}</dd></div>
        <div><dt>Artifacts</dt><dd>build {artifactState(run, 'build')} {'\u00b7'} tests {artifactState(run, 'tests')} {'\u00b7'} preview {artifactState(run, 'preview')}</dd></div>
        <div><dt>Verdict</dt><dd>{verdict?.recommendation || review?.recommendation || '--'}</dd></div>
      </dl>
      {review && !hasPanel ? (
        <div className="system-panel-opinions">
          <p className={review.releaseEligible ? '' : 'pending'}>
            <b>{review.source === 'ai' ? 'Artifact AI review' : review.source === 'fallback' ? 'Fallback review' : 'Artifact review'}</b>
            <span>{review.recommendation || 'review'} {'\u00b7'} {review.summary || 'Automated artifact review completed.'}</span>
          </p>
          <p className={job?.settlement?.release || job?.status === 'released' ? 'referee' : 'pending referee'}>
            <b>Settlement</b>
            <span>{job?.settlement?.release || job?.status === 'released' ? 'Released.' : review.releaseEligible ? 'Approved; waiting for settlement tick.' : 'Not release eligible.'}</span>
          </p>
        </div>
      ) : review || active ? (
        <div className="system-panel-opinions">
          {panelOpinionRoles.map(([role, label]) => {
            const opinion = opinionByRole.get(role)
            return (
              <p key={role} className={opinion ? '' : 'pending'}>
                <b>{label}</b>
                <span>{opinion ? `${opinion.recommendation || 'opinion'} \u00b7 ${opinion.summary || opinion.agent || ''}` : 'Waiting for live advocate output.'}</span>
              </p>
            )
          })}
          <p className={verdict ? 'referee' : 'pending referee'}>
            <b>Referee</b>
            <span>{verdict ? `${verdict.recommendation || review?.recommendation || 'verdict'} \u00b7 ${verdict.summary || review?.summary || ''}` : opinions.length < 2 ? `Waiting for both advocate opinions (${opinions.length}/2).` : 'Both opinions received; waiting for verdict.'}</span>
          </p>
        </div>
      ) : null}
    </section>
  )
}

export function LiveAgentRun({ runner, job, busy, error, active, onStart, onRefresh }) {
  const previewUrl = job?.submission?.url || runner.previewUrl
  const steps = [
    ['Agent', runner.steps?.agentStarted || runner.running],
    ['Job', runner.steps?.jobPosted || Boolean(job)],
    ['Bid', runner.steps?.bidPlaced || Boolean(job?.marketplace?.bids?.length)],
    ['Award', runner.steps?.awarded || Boolean(job?.marketplace?.awardedBid)],
    ['Build', runner.steps?.buildServed || Boolean(previewUrl)],
    ['Artifacts', Boolean(job?.review?.artifactRun)],
    ['Panel', Boolean(job?.review?.panel?.verdict || job?.review)],
  ]
  return (
    <section className={`system-run ${active ? 'guide-active' : ''}`}>
      <div className="system-run-head">
        <div><span>Live agent run</span><b>{runner.running ? 'Running' : runner.jobId ? 'Started' : 'Idle'}</b></div>
        <button onClick={onRefresh} title="Refresh live run"><RefreshCw size={15} /></button>
      </div>
      <div className="system-run-actions">
        <button onClick={onStart} disabled={busy}><Play size={15} />{busy ? 'Starting' : runner.jobId ? 'Resume bundled worker' : 'Run bundled worker'}</button>
        {previewUrl
          ? <a className="system-run-link" href={previewUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Open agent build</a>
          : <button disabled><ExternalLink size={15} />Open agent build</button>}
      </div>
      <div className="system-run-steps">
        {steps.map(([label, done]) => <span key={label} className={done ? 'done' : ''}>{label}</span>)}
      </div>
      {job ? (
        <dl>
          <div><dt>Job</dt><dd>{job.title}</dd></div>
          <div><dt>Status</dt><dd>{job.status}</dd></div>
          <div><dt>Agent</dt><dd>{runner.agentName || '--'}</dd></div>
        </dl>
      ) : null}
      {error || runner.error ? <p className="system-error small">{error || runner.error}</p> : null}
      {runner.logs?.length ? (
        <div className="system-run-log">
          {runner.logs.slice(-4).map((line) => <small key={line}>{line}</small>)}
        </div>
      ) : null}
    </section>
  )
}
