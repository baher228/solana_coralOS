import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { persistenceBackend, resetPersistenceForTest } from './persistence.js'

// These run only when a Postgres test DB is provided, e.g.:
//   TEST_DATABASE_URL=postgres://txodds:txodds@127.0.0.1:5432/txodds_test npm test
const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip

suite('postgres persistence', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url
    await resetPersistenceForTest()
    const p = persistenceBackend()
    await p.init()
    await p.saveJobs([])
    await p.saveAgents([])
  })

  afterAll(async () => {
    const p = persistenceBackend()
    await p.saveJobs([])
    await p.saveAgents([])
    await resetPersistenceForTest()
    delete process.env.DATABASE_URL
  })

  it('round-trips jobs and applies upsert + delete', async () => {
    const p = persistenceBackend()
    await p.saveJobs([
      { id: 'job_1', status: 'funded', title: 'First' } as never,
      { id: 'job_2', status: 'open', title: 'Second' } as never,
    ])
    expect((await p.loadJobs()).length).toBe(2)

    // Re-save with one job updated and the other removed.
    await p.saveJobs([{ id: 'job_1', status: 'released', title: 'First v2' } as never])
    const loaded = (await p.loadJobs()) as Array<{ id: string; status: string; title: string }>
    expect(loaded.length).toBe(1)
    expect(loaded[0]).toMatchObject({ id: 'job_1', status: 'released', title: 'First v2' })
  })

  it('round-trips connected agents', async () => {
    const p = persistenceBackend()
    await p.saveAgents([{ id: 'agent_1', name: 'demo-worker' } as never])
    const loaded = (await p.loadAgents()) as Array<{ id: string; name: string }>
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({ id: 'agent_1', name: 'demo-worker' })
  })

  it('records settlement intent and its outcome', async () => {
    const p = persistenceBackend()
    const id = await p.recordSettlementIntent('job_1', 'release')
    expect(id).toBeTruthy()
    await expect(p.markSettlement(id, 'confirmed', { signature: 'sig-abc' })).resolves.toBeUndefined()
  })

  it('runs the settlement tick under the leader lock', async () => {
    const p = persistenceBackend()
    const result = await p.withLeaderLock(async () => 'settled')
    expect(result).toBe('settled')
  })
})
