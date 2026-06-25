import { AgentAction, AgentState } from './types.js'
import type { Strategy, MutableAgentState } from './strategy.js'
import { AgentRole } from './role.js'

/**
 * A single autonomous agent. Holds one pluggable `Strategy` and an action log.
 *
 * Lifecycle:
 * 1. Create: `new Agent(id, strategy)` — agent is idle.
 * 2. Start:  `await agent.start()` — spawns the strategy loop via `AbortController`.
 * 3. Stop:   `agent.stop()` — aborts the loop; the strategy resolves cleanly.
 *
 * The agent's mutable state (actions, RPC endpoint, etc.) is accessed through a
 * `MutableAgentState` view created via `makeMutable()` and passed into the strategy.
 */
export class Agent {
  readonly id: string
  private _strategy: Strategy
  private _running = false
  private _rpcEndpoint = 'https://api.devnet.solana.com'
  private _network = 'devnet'
  private _actions: AgentAction[] = []
  private _abortController: AbortController | null = null

  /** The agent's current role. Defaults to `Worker`. */
  role: AgentRole = AgentRole.Worker

  constructor(id: string, strategy: Strategy) {
    this.id = id
    this._strategy = strategy
  }

  /** `true` while the strategy loop is actively running. */
  get isRunning(): boolean { return this._running }

  /** The currently attached strategy object. */
  get strategy(): Strategy { return this._strategy }

  /**
   * Hot-swap the strategy. The swap takes effect on the **next** `start()` call;
   * it does not restart a running agent.
   */
  setStrategy(strategy: Strategy): void {
    this._strategy = strategy
  }

  /**
   * Override the Solana RPC endpoint. Automatically infers `network` from the URL:
   * - Contains `"devnet"` → `"devnet"`
   * - Contains `"testnet"` → `"testnet"`
   * - Contains `"mainnet"` → `"mainnet-beta"`
   */
  setRpc(url: string): void {
    this._rpcEndpoint = url
    const url_ = url.toLowerCase()
    if (url_.includes('devnet')) this._network = 'devnet'
    else if (url_.includes('testnet')) this._network = 'testnet'
    else if (url_.includes('mainnet')) this._network = 'mainnet-beta'
  }

  /**
   * Append an action to the agent's log. Capped at 500 entries; oldest are evicted.
   * Called by strategies via `MutableAgentState.recordAction`.
   */
  recordAction(actionType: string, details: string, txSignature?: string, slot?: number): void {
    this._actions.push({
      timestamp: new Date().toISOString(),
      action_type: actionType,
      details,
      tx_signature: txSignature ?? null,
      slot: slot ?? null,
      latency_ms: 0,
    })
    if (this._actions.length > 500) this._actions.splice(0, this._actions.length - 500)
  }

  /** Return a serialisable snapshot of the current state. Actions array is a shallow copy. */
  state(): AgentState {
    return {
      is_running: this._running,
      actions: [...this._actions],
      rpc_endpoint: this._rpcEndpoint,
      network: this._network,
      strategy: this._strategy.name,
    }
  }

  /**
   * Build the `MutableAgentState` view passed into `Strategy.run()` and
   * `Strategy.handleMessage()`. The view proxies reads to the current field values
   * so strategies always see up-to-date config without holding a reference to `Agent`.
   */
  private makeMutable(): MutableAgentState {
    const agent = this
    return {
      get id() { return agent.id },
      get rpcEndpoint() { return agent._rpcEndpoint },
      get network() { return agent._network },
      recordAction: this.recordAction.bind(this),
      snapshot: this.state.bind(this),
    }
  }

  /**
   * Deliver a message to this agent's strategy and return its response.
   * Mirrors Rust: `agent.get_strategy().handle_message(text, state_arc)`.
   */
  async handleMessage(text: string): Promise<string> {
    return this._strategy.handleMessage(text, this.makeMutable())
  }

  /**
   * Start the strategy loop. Returns `false` if the agent is already running.
   * Errors thrown by the strategy after the abort signal fires are silently ignored;
   * errors before the signal is fired are recorded as `"strategy-error"` actions.
   */
  async start(): Promise<boolean> {
    if (this._running) return false
    this._running = true
    this._abortController = new AbortController()
    const signal = this._abortController.signal
    const mutable = this.makeMutable()

    this._strategy.run(mutable, signal)
      .catch((e) => {
        if (!signal.aborted) {
          this.recordAction('strategy-error', String(e))
        }
      })
      .finally(() => {
        this._running = false
      })

    this.recordAction('strategy-start', `started ${this._strategy.name}`)
    return true
  }

  /**
   * Signal the strategy loop to stop by aborting the `AbortController`.
   * Returns `false` if the agent was not running.
   */
  stop(): boolean {
    if (!this._running) return false
    this._abortController?.abort()
    this._running = false
    return true
  }
}
