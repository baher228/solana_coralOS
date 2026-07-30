/**
 * Persistence backend for jobs, connected agents, and the settlement outbox.
 *
 * Two implementations are selected at runtime:
 *   - FilePersistence (default): the original atomic JSON files under `.data/`. Fine for local
 *     development and tests.
 *   - PgPersistence (when `DATABASE_URL` is set): PostgreSQL with per-entity upserts inside a
 *     transaction, a durable settlement outbox, and a Postgres advisory lock so only one instance
 *     runs the settlement tick ("single leader"). This is the production path.
 *
 * The in-memory maps in `store.ts` remain the working set (single-writer, write-through cache);
 * this module makes writes durable/atomic and records settlement intent so on-chain transactions
 * and local state cannot silently diverge.
 */
import fs from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { AGENTS_FILE, DATA_DIR, DATA_FILE } from './config.js'

export type SettlementAction = 'deposit' | 'release' | 'refund'
export type SettlementStatus = 'confirmed' | 'failed'

export interface Persistence {
  init(): Promise<void>
  loadJobs(): Promise<unknown[]>
  loadAgents(): Promise<unknown[]>
  saveJobs(jobs: Array<{ id: string; status: string }>): Promise<void>
  saveAgents(agents: Array<{ id: string }>): Promise<void>
  /** Record intent to move funds before signing. Returns an id (or null when unsupported). */
  recordSettlementIntent(jobId: string, action: SettlementAction): Promise<string | null>
  /** Record the outcome of a settlement attempt referenced by {@link recordSettlementIntent}. */
  markSettlement(id: string | null, status: SettlementStatus, detail: { signature?: string; error?: string }): Promise<void>
  /** Run `fn` only if this instance holds the settlement leader lock; otherwise resolve undefined. */
  withLeaderLock<T>(fn: () => Promise<T>): Promise<T | undefined>
  /** Readiness check: resolves true when the backend is reachable. */
  ping(): Promise<boolean>
  close(): Promise<void>
}

export function databaseEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim())
}

async function writeFileAtomic(file: string, contents: string): Promise<void> {
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  await fs.writeFile(tmp, contents)
  await fs.rename(tmp, file)
}

async function readJsonArray(file: string): Promise<unknown[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

class FilePersistence implements Persistence {
  async init(): Promise<void> {}
  loadJobs(): Promise<unknown[]> { return readJsonArray(DATA_FILE) }
  loadAgents(): Promise<unknown[]> { return readJsonArray(AGENTS_FILE) }
  async saveJobs(jobs: Array<{ id: string; status: string }>): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true })
    await writeFileAtomic(DATA_FILE, JSON.stringify(jobs, null, 2))
  }
  async saveAgents(agents: Array<{ id: string }>): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true })
    await writeFileAtomic(AGENTS_FILE, JSON.stringify(agents, null, 2))
  }
  async recordSettlementIntent(): Promise<string | null> { return null }
  async markSettlement(): Promise<void> {}
  async withLeaderLock<T>(fn: () => Promise<T>): Promise<T | undefined> { return fn() }
  async ping(): Promise<boolean> { return true }
  async close(): Promise<void> {}
}

// A stable 63-bit key for pg_try_advisory_lock so every instance competes for the same lock.
const LEADER_LOCK_KEY = 902_133_701

class PgPersistence implements Persistence {
  private pool: pg.Pool
  private ready?: Promise<void>

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: Number(process.env.PGPOOL_MAX ?? 10) })
  }

  init(): Promise<void> {
    if (!this.ready) this.ready = this.migrate()
    return this.ready
  }

  private async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id text PRIMARY KEY,
        status text NOT NULL,
        payload jsonb NOT NULL,
        version integer NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS agents (
        id text PRIMARY KEY,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS settlement_outbox (
        id bigserial PRIMARY KEY,
        job_id text NOT NULL,
        action text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        signature text,
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS settlement_outbox_pending_idx ON settlement_outbox (status) WHERE status = 'pending';
    `)
  }

  async loadJobs(): Promise<unknown[]> {
    const { rows } = await this.pool.query<{ payload: unknown }>('SELECT payload FROM jobs')
    return rows.map((r) => r.payload)
  }

  async loadAgents(): Promise<unknown[]> {
    const { rows } = await this.pool.query<{ payload: unknown }>('SELECT payload FROM agents')
    return rows.map((r) => r.payload)
  }

  async saveJobs(jobs: Array<{ id: string; status: string }>): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      for (const job of jobs) {
        await client.query(
          `INSERT INTO jobs (id, status, payload, version, updated_at)
           VALUES ($1, $2, $3::jsonb, 1, now())
           ON CONFLICT (id) DO UPDATE
             SET status = EXCLUDED.status,
                 payload = EXCLUDED.payload,
                 version = jobs.version + 1,
                 updated_at = now()`,
          [job.id, job.status, JSON.stringify(job)],
        )
      }
      const ids = jobs.map((j) => j.id)
      await client.query('DELETE FROM jobs WHERE NOT (id = ANY($1::text[]))', [ids])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      client.release()
    }
  }

  async saveAgents(agents: Array<{ id: string }>): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      for (const agent of agents) {
        await client.query(
          `INSERT INTO agents (id, payload, updated_at)
           VALUES ($1, $2::jsonb, now())
           ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
          [agent.id, JSON.stringify(agent)],
        )
      }
      const ids = agents.map((a) => a.id)
      await client.query('DELETE FROM agents WHERE NOT (id = ANY($1::text[]))', [ids])
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      client.release()
    }
  }

  async recordSettlementIntent(jobId: string, action: SettlementAction): Promise<string | null> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO settlement_outbox (job_id, action, status) VALUES ($1, $2, 'pending') RETURNING id`,
      [jobId, action],
    )
    return rows[0]?.id ?? null
  }

  async markSettlement(id: string | null, status: SettlementStatus, detail: { signature?: string; error?: string }): Promise<void> {
    if (!id) return
    await this.pool.query(
      `UPDATE settlement_outbox SET status = $2, signature = $3, error = $4, updated_at = now() WHERE id = $1`,
      [id, status, detail.signature ?? null, detail.error ?? null],
    )
  }

  async withLeaderLock<T>(fn: () => Promise<T>): Promise<T | undefined> {
    const client = await this.pool.connect()
    try {
      const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [LEADER_LOCK_KEY])
      if (!rows[0]?.locked) return undefined
      try {
        return await fn()
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [LEADER_LOCK_KEY]).catch(() => {})
      }
    } finally {
      client.release()
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1')
      return true
    } catch {
      return false
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

let active: Persistence | null = null

export function persistenceBackend(): Persistence {
  if (active) return active
  const url = process.env.DATABASE_URL?.trim()
  active = url ? new PgPersistence(url) : new FilePersistence()
  return active
}

/** Test helper: drop the cached backend so a new DATABASE_URL takes effect. */
export async function resetPersistenceForTest(): Promise<void> {
  if (active) await active.close().catch(() => {})
  active = null
}
