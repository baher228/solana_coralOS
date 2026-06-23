import type { Strategy, MutableAgentState } from '../strategy.js'
import { untilAborted } from '../strategy.js'

export class IdleStrategy implements Strategy {
  readonly name = 'idle'

  async run(state: MutableAgentState, signal: AbortSignal): Promise<void> {
    const tick = setInterval(() => {
      state.recordAction('idle-tick', 'agent is idle')
    }, 60_000)
    await untilAborted(signal)
    clearInterval(tick)
  }
}
