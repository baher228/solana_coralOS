import { BaseStrategy, MutableAgentState, untilAborted } from '../strategy.js'

/**
 * Default no-op strategy. Records an `"idle-tick"` action every 60 seconds so the
 * action log proves the agent is alive, but does nothing else.
 *
 * Used automatically when `AgentManager.createAgent` is called without a strategy.
 */
export class IdleStrategy extends BaseStrategy {
  readonly name = 'idle'

  async run(state: MutableAgentState, signal: AbortSignal): Promise<void> {
    const tick = setInterval(() => {
      state.recordAction('idle-tick', 'agent is idle')
    }, 60_000)
    await untilAborted(signal)
    clearInterval(tick)
  }
}
