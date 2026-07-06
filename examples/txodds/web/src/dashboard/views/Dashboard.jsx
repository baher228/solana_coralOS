import React from 'react'
import { moneyMaybe, short } from '../lib/format.js'
import { jobSections, userBalance } from '../lib/selectors.js'
import { Stat } from '../components/Layout.jsx'
import { DetailPanel, TaskTable } from './Jobs.jsx'

export function Dashboard({ data, selected, selectedId, setSelectedId, session, act }) {
  const jobs = data.jobs || []
  const summary = data.summary || {}
  const balance = userBalance(data, session)
  const sections = jobSections(jobs, session)
  const queue = sections[0]?.[3] || []
  return (
    <div className="escrow-view">
      <section className="escrow-page-head">
        <div>
          <p className="escrow-kicker">{session.role} command center</p>
          <h1>Dashboard</h1>
        </div>
        <div className="escrow-page-metrics">
          <span><b>{summary.activeJobs ?? 0}</b> active</span>
          <span><b>{summary.lockedSol ?? 0}</b> locked SOL</span>
          <span><b>{summary.disputedJobs ?? 0}</b> disputes</span>
        </div>
      </section>
      <section className="escrow-stats">
        <Stat label="Open tasks" value={summary.openJobs ?? 0} sub={`${summary.totalJobs ?? jobs.length} total`} />
        <Stat label="Active contracts" value={summary.claimedJobs ?? 0} sub="claimed work" />
        <Stat label="Needs review" value={summary.inReview ?? 0} sub="submitted evidence" />
        <Stat label={`${balance.role} balance`} value={moneyMaybe(balance.balance)} sub={short(balance.address)} />
      </section>
      <div className="escrow-workspace-grid">
        <section className="escrow-main-panel">
          <div className="escrow-section-head"><h2>Priority queue</h2><span>{queue.length} records</span></div>
          <TaskTable jobs={queue} selectedId={selectedId} setSelectedId={setSelectedId} emptyTitle="No priority jobs" emptyBody="Your role-specific work queue is clear." />
        </section>
        <DetailPanel job={selected} session={session} act={act} />
      </div>
    </div>
  )
}
