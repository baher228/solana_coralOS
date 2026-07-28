import http from 'node:http'
import { loadEnv, PORT } from './config.js'
import { loadAgents, loadJobs, saveJobs } from './store.js'
import { createHandler } from './http/index.js'
import { runBackendTicks } from './http/ticks.js'
import { databaseEnabled, persistenceBackend } from './persistence.js'
import { logger } from './logger.js'

export * from './types.js'
export { loadEnv } from './config.js'
export { createConnectedAgent, revokeConnectedAgent, resetStoresForTest } from './store.js'
export * from './domain/index.js'
export * from './review/index.js'
export { createHandler, resetJobsForTest } from './http/index.js'

export async function startServer(): Promise<void> {
  await loadEnv()
  const persistence = persistenceBackend()
  await persistence.init()
  await loadJobs()
  await loadAgents()
  let tickRunning = false
  setInterval(async () => {
    if (tickRunning) return
    tickRunning = true
    try {
      // Only the instance holding the advisory leader lock settles escrow, so
      // running multiple API instances can't double-award or double-settle.
      await persistence.withLeaderLock(async () => {
        if (await runBackendTicks({})) await saveJobs()
      })
    } catch (e) {
      logger.error('market tick failed', { error: e as Error })
    } finally {
      tickRunning = false
    }
  }, 5000).unref()
  http.createServer(createHandler()).listen(PORT, () => {
    logger.info('api listening', { port: PORT, persistence: databaseEnabled() ? 'postgres' : 'file' })
  })
}
