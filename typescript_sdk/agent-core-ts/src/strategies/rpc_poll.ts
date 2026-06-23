import type { Strategy, MutableAgentState } from '../strategy.js'
import { untilAborted } from '../strategy.js'
import { Connection } from '@solana/web3.js'

export class RpcPollStrategy implements Strategy {
  readonly name = 'rpc-poll'
  private intervalMs: number

  constructor(intervalMs = 10_000) {
    this.intervalMs = intervalMs
  }

  async run(state: MutableAgentState, signal: AbortSignal): Promise<void> {
    const conn = new Connection(state.rpcEndpoint)

    while (!signal.aborted) {
      const start = Date.now()
      try {
        const slot = await conn.getSlot()
        state.recordAction('poll-tick', `slot=${slot}`, undefined, slot)
      } catch (e) {
        state.recordAction('poll-error', String(e))
      }
      // Sleep intervalMs, but abort immediately if signal fires
      await Promise.race([
        new Promise(r => setTimeout(r, this.intervalMs)),
        untilAborted(signal),
      ])
    }
  }
}
