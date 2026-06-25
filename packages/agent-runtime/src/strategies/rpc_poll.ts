import { BaseStrategy, MutableAgentState, untilAborted } from '../strategy.js'
import { Connection } from '@solana/web3.js'

/**
 * Simple liveness-check strategy. Polls `getSlot()` on the configured Solana RPC
 * endpoint at a fixed interval and records each slot number as a `"poll-tick"` action.
 *
 * Useful as a canary — if `"poll-tick"` stops appearing in the action log, the RPC
 * endpoint is unreachable.
 */
export class RpcPollStrategy extends BaseStrategy {
  readonly name = 'rpc-poll'
  private intervalMs: number

  /**
   * @param intervalMs - How often to poll the RPC endpoint. Defaults to 10 seconds.
   */
  constructor(intervalMs = 10_000) {
    super()
    this.intervalMs = intervalMs
  }

  async run(state: MutableAgentState, signal: AbortSignal): Promise<void> {
    const conn = new Connection(state.rpcEndpoint)

    while (!signal.aborted) {
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
