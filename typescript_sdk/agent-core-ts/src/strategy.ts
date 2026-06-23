import type { AgentState } from './types.js'

// Mirror of Rust Strategy trait.
// Implement this interface to define agent behaviour.
export interface Strategy {
  readonly name: string
  run(state: MutableAgentState, signal: AbortSignal): Promise<void>
}

// Internal mutable view passed into strategy.run()
export interface MutableAgentState {
  readonly id: string
  readonly rpcEndpoint: string
  readonly network: string
  recordAction(actionType: string, details: string, txSignature?: string, slot?: number): void
  snapshot(): AgentState
}

export function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return }
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}
