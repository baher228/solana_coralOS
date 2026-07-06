import http from 'node:http'
import { loadEnv, PORT } from './config.js'
import { loadAgents, loadJobs, saveJobs } from './store.js'
import { createHandler } from './http/index.js'
import { runBackendTicks } from './http/ticks.js'

export * from './types.js'
export { loadEnv } from './config.js'
export { createConnectedAgent, revokeConnectedAgent, resetStoresForTest } from './store.js'
export * from './domain/index.js'
export * from './review/index.js'
export { createHandler, resetJobsForTest } from './http/index.js'

export async function startServer(): Promise<void> {
  await loadEnv()
  await loadJobs()
  await loadAgents()
  let tickRunning = false
  setInterval(async () => {
    if (tickRunning) return
    tickRunning = true
    try {
      if (await runBackendTicks({})) await saveJobs()
    } catch (e) {
      console.error(`[freelance-escrow] market tick: ${(e as Error).message}`)
    } finally {
      tickRunning = false
    }
  }, 5000).unref()
  http.createServer(createHandler()).listen(PORT, () => {
    console.error(`[freelance-escrow] API on http://localhost:${PORT}`)
  })
}
