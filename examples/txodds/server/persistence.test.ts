import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createJob, addEvent, recordReview } from './state.js'
import { loadJobs, saveJobs } from './persistence.js'

const tmpFile = (name: string): string => path.join(os.tmpdir(), `txodds-${name}-${Date.now()}-${Math.random()}.json`)

describe('job persistence', () => {
  it('starts clean when the persistence file is missing or corrupt', async () => {
    expect(await loadJobs(tmpFile('missing'))).toEqual([])
    const file = tmpFile('corrupt')
    await fs.writeFile(file, '{nope', 'utf8')
    expect(await loadJobs(file)).toEqual([])
  })

  it('round-trips jobs with reviews, events and settlement metadata', async () => {
    const file = tmpFile('jobs')
    const job = createJob('job_1', {
      title: 'Docs',
      requirements: 'Write auth docs.',
      acceptanceCriteria: 'Include curl example.',
      amountSol: 0.001,
      deadlineSecs: 600,
    }, 1)
    addEvent(job, 'evt_1', 'created', 'employer', 'Job created')
    recordReview(job, {
      approved: true,
      score: 90,
      confidence: 0.8,
      summary: 'ok',
      missing: [],
      releaseReason: 'complete',
      criteria: [{ text: 'Include curl example', score: 90, verdict: 'pass', evidence: 'curl', missing: '' }],
    })
    job.settlement.open = { sig: 'openSig', explorer: 'https://example.test/openSig' }

    await saveJobs([job], file)
    const loaded = await loadJobs(file)
    expect(loaded[0].reviews[0].score).toBe(90)
    expect(loaded[0].events[0].type).toBe('created')
    expect(loaded[0].settlement.open?.sig).toBe('openSig')
  })
})
