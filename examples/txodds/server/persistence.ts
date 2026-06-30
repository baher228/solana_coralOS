import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Job } from './state.js'

export const DEFAULT_STORE_PATH = fileURLToPath(new URL('../.data/jobs.json', import.meta.url))

function normalizeJob(job: Job): Job {
  return {
    ...job,
    messages: job.messages ?? [],
    reviews: job.reviews ?? (job.review ? [job.review] : []),
    disputes: job.disputes ?? [],
    events: job.events ?? [],
  }
}

export async function loadJobs(file = DEFAULT_STORE_PATH): Promise<Job[]> {
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8'))
    return Array.isArray(data?.jobs) ? data.jobs.map(normalizeJob) : []
  } catch {
    return []
  }
}

export async function saveJobs(jobs: Iterable<Job>, file = DEFAULT_STORE_PATH): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify({ jobs: [...jobs] }, null, 2), 'utf8')
}
