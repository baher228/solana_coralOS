import React, { useEffect, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { api } from '../lib/api.js'
import { money, party, short, statusText } from '../lib/format.js'
import { activeDispute, canClaim, canReviewWork, canSubmitWork, isJobParty, jobSections } from '../lib/selectors.js'
import { Badge, Empty, Field } from '../components/Common.jsx'
import { ArtifactReport, ReviewReport } from './Reviews.jsx'

export function TaskTable({ jobs, selectedId, setSelectedId, emptyTitle = 'No tasks yet', emptyBody = 'Post a task or claim open work to start the workflow.' }) {
  if (!jobs.length) {
    return <Empty title={emptyTitle} body={emptyBody} />
  }

  return (
    <section className="escrow-table">
      <div className="escrow-table-head">
        <span>Task</span><span>Client / worker</span><span>Budget</span><span>Status</span>
      </div>
      {jobs.map((job) => (
        <button
          key={job.id}
          className={`escrow-row ${selectedId === job.id ? 'on' : ''}`}
          onClick={() => setSelectedId(job.id)}
        >
          <span><b>{job.title}</b><small>{short(job.reference)}</small></span>
          <span>{party(job.employer)}<small>{job.status === 'open' ? 'Waiting for worker' : party(job.worker)}</small></span>
          <span><b>{money(job.amountSol)}</b><small>{job.settlement.mode}</small></span>
          <span><Badge status={job.status} /></span>
        </button>
      ))}
    </section>
  )
}

export function PostTask({ session, createTask }) {
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
    return (
      <section className="escrow-create-closed">
        <div><b>Post an open job</b><span>Set scope, milestones, and budget. Workers claim it from the job board.</span></div>
        <button className="escrow-primary" onClick={() => setOpen(true)}>Post task</button>
      </section>
    )
  }

  return (
    <form className="escrow-create" onSubmit={(e) => {
      e.preventDefault()
      createTask({ ...form, marketplace: true, amountSol: Number(form.amountSol) || 0.001 })
      setOpen(false)
    }}>
      <div className="escrow-section-head"><h2>Post task</h2><button type="button" className="escrow-ghost" onClick={() => setOpen(false)}>Close</button></div>
      <div className="escrow-form-grid">
        <Field label="Employer"><input value={form.employer} onInput={set('employer')} /></Field>
        <Field label="Title"><input value={form.title} onInput={set('title')} /></Field>
        <Field label="Budget"><input type="number" min="0.001" step="0.001" value={form.amountSol} onInput={set('amountSol')} /></Field>
      </div>
      <Field label="Scope"><textarea value={form.scope} onInput={set('scope')} /></Field>
      <Field label="Acceptance criteria"><textarea value={form.acceptanceCriteria} onInput={set('acceptanceCriteria')} /></Field>
      <Field label="Milestones"><textarea value={form.milestones} onInput={set('milestones')} /></Field>
      <button className="escrow-primary">Post open task</button>
    </form>
  )
}

export function SubmissionEvidence({ job }) {
  if (!job?.submission) return null
  return (
    <section className="escrow-evidence">
      <div><span>Preview</span>{job.submission.url ? <a href={job.submission.url} target="_blank" rel="noreferrer">{job.submission.url}</a> : <b>Missing</b>}</div>
      <div><span>Repository</span>{job.submission.repo ? <a href={job.submission.repo} target="_blank" rel="noreferrer">{job.submission.repo}</a> : <b>Missing</b>}</div>
      <p>{job.submission.notes || 'No worker notes were submitted.'}</p>
    </section>
  )
}

export function MarketplaceStatus({ job }) {
  const market = job?.marketplace
  const devnet = job?.settlement?.devnet
  if (!market && !devnet) return null
  const awarded = market?.awardedBid
  return (
    <section className="escrow-mini-list">
      <div className="escrow-section-head"><h3>Agent marketplace</h3><span>{market?.status || job.settlement.mode}</span></div>
      {market ? <p><span>Posted budget</span><b>{money(market.budgetSol)}</b></p> : null}
      {market ? <p><span>Bids</span><b>{market.bids?.length || 0}</b></p> : null}
      {awarded ? <p><span>Awarded agent</span><b>{awarded.by}</b></p> : null}
      {awarded ? <p><span>Winning bid</span><b>{money(awarded.priceSol)}</b></p> : null}
      {devnet ? <p><span>Worker wallet</span><b title={devnet.seller}>{short(devnet.seller)}</b></p> : null}
      {devnet?.deposit ? <p><span>Deposit sig</span><b title={devnet.deposit}>{short(devnet.deposit)}</b></p> : null}
      {devnet?.release ? <p><span>Release sig</span><b title={devnet.release}>{short(devnet.release)}</b></p> : null}
      {devnet?.refund ? <p><span>Refund sig</span><b title={devnet.refund}>{short(devnet.refund)}</b></p> : null}
    </section>
  )
}

export function DisputePanel({ dispute }) {
  return (
    <section className="escrow-dispute-panel">
      <div>
        <span>{dispute.status === 'open' ? 'Active dispute' : 'Resolved dispute'}</span>
        <b>{dispute.by === 'worker' ? 'Worker' : 'Employer'}</b>
      </div>
      <p>{dispute.note}</p>
      {dispute.summary ? <small>{dispute.summary}</small> : null}
      {dispute.outcome ? <strong>{statusText(dispute.outcome)}</strong> : null}
    </section>
  )
}

export function DeliveryActions({ job, session, act }) {
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
  return (
    <section className="escrow-task-action">
      <div className="escrow-section-head"><h3>{job.submission ? 'Resubmit work' : 'Submit work'}</h3><span>{statusText(job.status)}</span></div>
      <form className="escrow-submit" onSubmit={(e) => {
        e.preventDefault()
        act(() => api(`/api/jobs/${job.id}/submission`, submission))
      }}>
        <Field label="Preview URL"><input value={submission.url} onInput={set('url')} /></Field>
        <Field label="Repository"><input value={submission.repo} onInput={set('repo')} /></Field>
        <Field label="Delivery notes"><textarea value={submission.notes} onInput={set('notes')} /></Field>
        <button className="escrow-primary">{job.submission ? 'Resubmit work' : 'Submit work'}</button>
      </form>
    </section>
  )
}

export function ReviewActions({ job, session, act }) {
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
  return (
    <section className="escrow-task-action">
      <div className="escrow-section-head"><h3>{title}</h3><span>{releaseEligible ? 'release eligible' : statusText(job.status)}</span></div>
      <SubmissionEvidence job={job} />
      {dispute && <DisputePanel dispute={dispute} />}
      {job.review?.artifactRun && <ArtifactReport job={job} run={job.review.artifactRun} />}
      {job.review && <ReviewReport review={job.review} />}
      {employerCanReview ? (
        <div className="escrow-action-bar">
          <button className="escrow-primary" onClick={() => act(() => api(`/api/jobs/${job.id}/review`, { action: 'assess' }))}>Run AI review</button>
          <button className="escrow-primary" disabled={!canRelease} onClick={() => act(() => api(`/api/jobs/${job.id}/review`, { action: 'approve' }))}>Approve and release</button>
          <button className="escrow-ghost" disabled={!job.review} onClick={() => act(() => api(`/api/jobs/${job.id}/review`, { action: 'request_revision', note: revisionNote }))}>Request revision</button>
        </div>
      ) : null}
      {canOpenDispute ? (
        <div className="escrow-dispute-form">
          <Field label="Dispute reason"><textarea value={disputeNote} onInput={(e) => setDisputeNote(e.target.value)} placeholder="Name the acceptance item and what evidence is missing." /></Field>
          <button className="escrow-ghost" disabled={disputeNote.trim().length < 20} onClick={() => act(() => api(`/api/jobs/${job.id}/dispute`, { by: 'employer', note: disputeNote }))}>Open dispute</button>
        </div>
      ) : null}
      {canRunDisputeReview ? (
        <div className="escrow-action-bar">
          <button className="escrow-primary" onClick={() => act(() => api(`/api/jobs/${job.id}/dispute/review`, {}))}>Run dispute review</button>
        </div>
      ) : null}
    </section>
  )
}

export function DetailPanel({ job, session, act }) {
  if (!job) {
    return <Empty title="Select a task" body="Task details, terms, evidence, and escrow state show here." />
  }
  const done = job.milestones.filter((m) => m.status === 'complete').length
  const workerLine = job.status === 'open' ? 'Waiting for worker' : `${party(job.employer)} funds ${party(job.worker)}`
  return (
    <aside className="escrow-detail">
      <div className="escrow-section-head">
        <div><h2>{job.title}</h2><span>{workerLine}</span></div>
        <Badge status={job.status} />
      </div>
      {canClaim(job, session) && act ? (
        <button className="escrow-primary" onClick={() => act(() => api(`/api/jobs/${job.id}/claim`, { worker: session.organization, name: session.name }))}>Claim task</button>
      ) : null}
      <dl className="escrow-definition">
        <div><dt>Reference</dt><dd>{job.reference}</dd></div>
        <div><dt>Escrow</dt><dd>{job.settlement.escrow}</dd></div>
        <div><dt>Amount</dt><dd>{money(job.amountSol)}</dd></div>
        <div><dt>Milestones</dt><dd>{done}/{job.milestones.length}</dd></div>
      </dl>
      <MarketplaceStatus job={job} />
      <section className="escrow-terms">
        <b>Scope</b>
        <p>{job.scope || job.requirements}</p>
        <b>Acceptance</b>
        <p>{job.acceptanceCriteria}</p>
      </section>
      {act && <DeliveryActions job={job} session={session} act={act} />}
      {act && <ReviewActions job={job} session={session} act={act} />}
      <section className="escrow-mini-list">
        <div className="escrow-section-head"><h3>Milestones</h3><span>{done}/{job.milestones.length}</span></div>
        {job.milestones.map((m) => (
          <p key={m.id} className={m.status}>
            <span>{m.title}</span>
            <b>{money(m.amountSol)}</b>
          </p>
        ))}
      </section>
    </aside>
  )
}

export function JobTabs({ jobs, selectedId, setSelectedId, session }) {
  const sections = jobSections(jobs, session)
  const defaultValue = sections[0]?.[0]
  return (
    <Tabs.Root className="escrow-tabs" defaultValue={defaultValue}>
      <Tabs.List className="escrow-tab-list" aria-label="Job sections">
        {sections.map(([id, title, , sectionJobs]) => (
          <Tabs.Trigger key={id} value={id} className="escrow-tab-trigger">
            <span>{title}</span>
            <b>{sectionJobs.length}</b>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {sections.map(([id, title, subtitle, sectionJobs]) => (
        <Tabs.Content key={id} value={id} className="escrow-tab-panel">
          <section className="escrow-list-section">
            <div className="escrow-section-head"><div><h3>{title}</h3><span>{subtitle}</span></div><span>{sectionJobs.length}</span></div>
            <TaskTable jobs={sectionJobs} selectedId={selectedId} setSelectedId={setSelectedId} emptyTitle={`No ${title.toLowerCase()}`} emptyBody="Nothing matches this section yet." />
          </section>
        </Tabs.Content>
      ))}
    </Tabs.Root>
  )
}

export function YourJobs({ data, selected, selectedId, setSelectedId, session, createTask, act }) {
  const summary = data.summary || {}
  const heading = session.role === 'worker' ? 'Your work' : 'Your posted jobs'
  return (
    <div className="escrow-view">
      <section className="escrow-page-head">
        <div>
          <p className="escrow-kicker">{session.role} account</p>
          <h1>{heading}</h1>
        </div>
        <div className="escrow-page-metrics">
          <span><b>{summary.openJobs ?? 0}</b> open</span>
          <span><b>{summary.claimedJobs ?? 0}</b> active</span>
          <span><b>{summary.inReview ?? 0}</b> review</span>
        </div>
      </section>
      {session.role === 'employer' ? <PostTask session={session} createTask={createTask} /> : null}
      <div className="escrow-workspace-grid">
        <section className="escrow-main-panel">
          <div className="escrow-section-head"><h2>Job board</h2><span>{data.jobs.length} records</span></div>
          <JobTabs jobs={data.jobs} selectedId={selectedId} setSelectedId={setSelectedId} session={session} />
        </section>
        <DetailPanel job={selected} session={session} act={act} />
      </div>
    </div>
  )
}
