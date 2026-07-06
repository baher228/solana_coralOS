import React from 'react'
import { API } from '../lib/api.js'
import { statusText } from '../lib/format.js'

export function artifactHref(job, artifact) {
  return `${API}/api/jobs/${job.id}/artifacts/${artifact.id}`
}

export function ArtifactStatus({ label, item }) {
  return (
    <div className={`escrow-artifact-status ${item?.status || 'skipped'}`}>
      <span>{label}</span>
      <b>{statusText(item?.status || 'skipped')}</b>
      <p>{item?.summary || 'Not run'}</p>
      {item?.commit ? <small>Commit {item.commit}</small> : null}
      {item?.title ? <small>{item.title}</small> : null}
      {item?.command ? <small>{item.command}</small> : null}
    </div>
  )
}

export function ArtifactReport({ job, run }) {
  if (!run) return null
  const screenshots = run.screenshots || []
  const logs = run.logs || []
  return (
    <section className="escrow-artifact-report">
      <div className="escrow-section-head">
        <h3>Artifact review</h3>
        <span>{new Date(run.at).toLocaleString()}</span>
      </div>
      <div className="escrow-artifact-grid">
        <ArtifactStatus label="Repository" item={run.repo} />
        <ArtifactStatus label="Build" item={run.build} />
        <ArtifactStatus label="Tests" item={run.tests} />
        <ArtifactStatus label="Preview" item={run.preview} />
      </div>
      {screenshots.length ? (
        <div className="escrow-screenshots">
          {screenshots.map((shot) => (
            <a key={shot.id} href={artifactHref(job, shot)} target="_blank" rel="noreferrer">
              <img src={artifactHref(job, shot)} alt={shot.label} />
              <span>{shot.label}</span>
            </a>
          ))}
        </div>
      ) : <p className="escrow-muted">No screenshots captured.</p>}
      {logs.length ? (
        <div className="escrow-log-links">
          {logs.map((log) => <a key={log.id} href={artifactHref(job, log)} target="_blank" rel="noreferrer">{log.label}</a>)}
        </div>
      ) : null}
    </section>
  )
}

export function ReviewReport({ review }) {
  const checks = review.criteriaResults?.length ? review.criteriaResults : (review.checks || [])
  const missing = review.missing || []
  const risks = [...(review.criticalRisks || []), ...(review.risks || [])]
  const recommendation = review.recommendation || (review.approved ? 'approve' : 'revision')
  const source = review.source === 'ai' ? 'Artifact AI review' : review.source === 'coral-panel' ? 'Coral panel review' : review.source === 'fallback' ? 'Review unavailable' : 'Legacy review'
  const panel = review.panel
  return (
    <section className={`escrow-review-result ${recommendation}`}>
      <div className="escrow-review-top">
        <div>
          <span>{source}</span>
          <b>{review.score ?? 0}<small>/100</small></b>
        </div>
        <strong className={`escrow-review-pill ${review.releaseEligible ? 'approve' : recommendation}`}>
          {review.releaseEligible ? 'release eligible' : statusText(recommendation)}
        </strong>
      </div>
      <p>{review.summary}</p>
      {panel?.opinions?.length ? (
        <div className="escrow-review-checks">
          {panel.opinions.map((opinion, i) => (
            <div className="escrow-review-check pass" key={i}>
              <b>{opinion.role === 'worker' ? 'Worker advocate' : 'Employer advocate'}</b>
              <span>{statusText(opinion.recommendation || 'opinion')}</span>
              <p>{opinion.summary}</p>
              {opinion.agent ? <small>{opinion.agent}</small> : null}
            </div>
          ))}
        </div>
      ) : null}
      {review.autoReleaseAt && review.releaseEligible ? <div className="escrow-review-list"><b>Auto-release</b><p>{new Date(review.autoReleaseAt).toLocaleString()}</p></div> : null}
      {typeof review.confidence === 'number' ? <div className="escrow-review-list"><b>Confidence</b><p>{review.confidence}/100</p></div> : null}
      {checks.length ? (
        <div className="escrow-review-checks">
          {checks.map((check, i) => (
            <div className={`escrow-review-check ${check.status}`} key={i}>
              <b>{check.label}</b>
              <span>{statusText(check.status)}</span>
              <p>{check.reason || 'No detail provided.'}</p>
              {check.evidence ? <small>{check.evidence}</small> : null}
            </div>
          ))}
        </div>
      ) : null}
      {missing.length ? <div className="escrow-review-list"><b>Missing evidence</b><p>{missing.join(', ')}</p></div> : null}
      {risks.length ? <div className="escrow-review-list"><b>Risks</b><p>{risks.join(', ')}</p></div> : null}
      {review.revisionInstructions ? <div className="escrow-review-list"><b>Revision instructions</b><p>{review.revisionInstructions}</p></div> : null}
    </section>
  )
}
