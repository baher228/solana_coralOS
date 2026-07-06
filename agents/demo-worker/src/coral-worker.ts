import { startCoralAgent } from '@pay/agent-runtime/src/coral/server.ts'
import {
  formatDelivered,
  parseAward,
  parseDeposited,
  parseRefunded,
  parseReleased,
  verb,
} from '@pay/agent-runtime/src/market/protocol.ts'
import { threadKey, type WorkerConfig } from './config.ts'
import { createDelivery } from './delivery.ts'
import { createPreviewResolver } from './preview.ts'
import {
  bidMessage,
  chooseBidPrice,
  deliveryPayload,
  parseFreelanceWant,
  type DemoJob,
} from './logic.ts'

export async function runCoralWorker(config: WorkerConfig) {
  if (!config.wallet) throw new Error('Set DEMO_WORKER_WALLET or WALLET before running the Coral demo worker')
  const deliver = createDelivery(config, createPreviewResolver(config))
  const jobs = new Map<string, { job: DemoJob; awarded: boolean }>()
  await startCoralAgent({ agentName: config.agentName }, async (ctx) => {
    while (true) {
      const mention = await ctx.waitForMention()
      if (!mention) continue

      const want = parseFreelanceWant(mention.text)
      if (want) {
        const priceSol = chooseBidPrice(want.budgetSol, config.bidPriceSol)
        jobs.set(threadKey(mention.threadId, want.round), { job: want.job, awarded: false })
        await ctx.reply(mention, bidMessage({ round: want.round, priceSol, by: config.agentName, wallet: config.wallet }))
        console.error(`[${config.agentName}] bid ${priceSol} SOL on ${want.job.id}`)
        continue
      }

      if (verb(mention.text) === 'BID_ACCEPTED' || verb(mention.text) === 'BID_REJECTED') {
        console.error(`[${config.agentName}] ${mention.text}`)
        continue
      }

      const award = parseAward(mention.text)
      if (award) {
        if (award.to !== config.agentName) continue
        const item = jobs.get(threadKey(mention.threadId, award.round))
        if (item) item.awarded = true
        console.error(`[${config.agentName}] awarded round ${award.round}`)
        continue
      }

      const deposited = parseDeposited(mention.text)
      if (deposited) {
        const item = jobs.get(threadKey(mention.threadId, deposited.round))
        if (!item?.awarded) continue
        await ctx.reply(mention, formatDelivered(deliveryPayload(deposited.round, await deliver(item.job))))
        console.error(`[${config.agentName}] delivered round ${deposited.round}`)
        continue
      }

      const released = parseReleased(mention.text)
      if (released) {
        console.error(`[${config.agentName}] released ${released.sig}`)
        continue
      }

      const refunded = parseRefunded(mention.text)
      if (refunded) console.error(`[${config.agentName}] refunded ${refunded.sig}`)
    }
  })
}
