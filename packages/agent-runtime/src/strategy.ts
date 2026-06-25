import type { AgentState } from './types.js'

/**
 * Mutable view of agent state passed into `Strategy.run()` and `Strategy.handleMessage()`.
 * Strategies read config through this interface and write results via `recordAction`.
 */
export interface MutableAgentState {
  /** The agent's unique identifier. */
  readonly id: string
  /** Solana RPC endpoint the agent is configured to use. */
  readonly rpcEndpoint: string
  /** Network label derived from `rpcEndpoint` (`"devnet"` | `"mainnet-beta"` | …). */
  readonly network: string
  /**
   * Append an action to the agent's log. Log is capped at 500 entries.
   * @param actionType - Short identifier, e.g. `"poll-tick"`, `"payment-received"`.
   * @param details    - Human-readable description.
   * @param txSignature - Solana transaction signature, if applicable.
   * @param slot       - Solana slot number, if applicable.
   */
  recordAction(actionType: string, details: string, txSignature?: string, slot?: number): void
  /** Return a serialisable snapshot of the current agent state. */
  snapshot(): AgentState
}

/**
 * Pluggable behaviour interface for agents. Mirrors the Rust `Strategy` trait.
 *
 * Extend `BaseStrategy` instead of implementing this directly to get a default
 * `handleMessage` implementation.
 */
export interface Strategy {
  /** Short stable identifier written into `AgentState.strategy`. */
  readonly name: string
  /**
   * Main loop. Runs until `signal` is aborted (i.e. `agent.stop()` is called).
   * Must not throw after the signal fires — resolve cleanly instead.
   */
  run(state: MutableAgentState, signal: AbortSignal): Promise<void>
  /**
   * Called when a CoralOS mention or a payment-triggered message arrives.
   * Mirrors the Rust `Strategy::handle_message` default impl.
   * @param text  - Raw message text (often JSON).
   * @param state - Mutable view of the receiving agent's state.
   * @returns Response string sent back to the caller.
   */
  handleMessage(text: string, state: MutableAgentState): Promise<string>
}

/**
 * Abstract base class with a sensible default `handleMessage`.
 * Students extend this rather than implementing `Strategy` directly.
 */
export abstract class BaseStrategy implements Strategy {
  abstract readonly name: string
  abstract run(state: MutableAgentState, signal: AbortSignal): Promise<void>

  async handleMessage(text: string, _state: MutableAgentState): Promise<string> {
    return `agent received: ${text.slice(0, 120)}`
  }
}

/**
 * Returns a `Promise<void>` that resolves as soon as `signal` is aborted.
 * Use inside strategy loops to sleep without busy-polling:
 *
 * @example
 * await Promise.race([new Promise(r => setTimeout(r, 5_000)), untilAborted(signal)])
 */
export function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return }
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}
