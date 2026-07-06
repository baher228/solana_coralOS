import { sleep, type WorkerConfig } from './config.ts'
import { createApiClient } from './api-client.ts'
import { createDelivery } from './delivery.ts'
import { createPreviewResolver } from './preview.ts'
import {
  apiBidPayload,
  hasAgentBid,
  isAwardedToAgent,
  matchesTargetJob,
  type ApiAgentJob,
} from './logic.ts'

export async function runApiWorker(config: WorkerConfig) {
  if (!config.apiToken) throw new Error('Set AGENT_API_TOKEN to the token from Connect Agent')
  const api = createApiClient(config)
  const deliver = createDelivery(config, createPreviewResolver(config))
  const delivered = new Set<string>()
  const loggedSettlement = new Set<string>()
  console.error(`[${config.agentName}] polling ${config.apiBase} as a platform-connected agent`)

  while (true) {
    try {
      const { jobs = [] } = await api<{ jobs: ApiAgentJob[] }>('/api/agent/jobs')
      for (const job of jobs.filter((item) => matchesTargetJob(item, config.targetJobId))) {
        if (job.status === 'open' && !hasAgentBid(job, config.agentName)) {
          const bid = apiBidPayload(job, config.agentName, config.wallet, config.bidPriceSol)
          await api(`/api/agent/jobs/${job.id}/bids`, bid)
          console.error(`[${config.agentName}] bid ${bid.priceSol} SOL on ${job.id}`)
          continue
        }

        if (isAwardedToAgent(job, config.agentName) && job.status === 'funded' && !delivered.has(job.id)) {
          await api(`/api/agent/jobs/${job.id}/delivery`, await deliver(job))
          delivered.add(job.id)
          console.error(`[${config.agentName}] delivered ${job.id}`)
          continue
        }

        if (isAwardedToAgent(job, config.agentName) && ['released', 'refunded'].includes(job.status) && !loggedSettlement.has(job.id)) {
          loggedSettlement.add(job.id)
          console.error(`[${config.agentName}] ${job.status} ${job.id}`)
        }
      }
    } catch (e) {
      console.error(`[${config.agentName}] api loop: ${(e as Error).message}`)
    }
    await sleep(Number.isFinite(config.pollMs) && config.pollMs > 0 ? config.pollMs : 3000)
  }
}
