import { runAgentMarketTick, type DevnetEscrowAdapter } from '../domain/index.js'
import { autoReleaseExpiredJobs } from '../review/index.js'

export async function runBackendTicks(options: { escrowAdapter?: DevnetEscrowAdapter }): Promise<number> {
  return autoReleaseExpiredJobs() + await runAgentMarketTick(options.escrowAdapter)
}
