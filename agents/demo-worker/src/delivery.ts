import { complete } from '@pay/agent-runtime/src/llm/complete.ts'
import { sleep, type WorkerConfig } from './config.ts'
import { deliveryNotes, type DemoJob } from './logic.ts'

export function createDelivery(config: WorkerConfig, previewUrl: (job: DemoJob) => Promise<string>) {
  return async function deliver(job: DemoJob & { marketplace?: { round?: number } }) {
    const url = await previewUrl(job)
    if (config.deliveryDelayMs > 0) await sleep(config.deliveryDelayMs)
    const notes = await deliveryNotes(job, config.deliveryNotes, complete)
    return {
      round: job.marketplace?.round || 1,
      url,
      ...(config.deliveryRepo ? { repo: config.deliveryRepo } : {}),
      ...(config.reviewMode ? { reviewMode: config.reviewMode } : {}),
      notes,
    }
  }
}
