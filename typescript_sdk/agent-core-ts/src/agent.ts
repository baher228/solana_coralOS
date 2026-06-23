import { AgentAction, AgentState } from './types.js'
import type { Strategy, MutableAgentState } from './strategy.js'
import { AgentRole } from './role.js'

export class Agent {
  readonly id: string
  private _strategy: Strategy
  private _running = false
  private _rpcEndpoint = 'https://api.devnet.solana.com'
  private _network = 'devnet'
  private _actions: AgentAction[] = []
  private _abortController: AbortController | null = null
  role: AgentRole = AgentRole.Worker

  constructor(id: string, strategy: Strategy) {
    this.id = id
    this._strategy = strategy
  }

  get isRunning(): boolean { return this._running }
  get strategy(): Strategy { return this._strategy }

  setStrategy(strategy: Strategy): void {
    this._strategy = strategy
  }

  setRpc(url: string): void {
    this._rpcEndpoint = url
    const url_ = url.toLowerCase()
    if (url_.includes('devnet')) this._network = 'devnet'
    else if (url_.includes('testnet')) this._network = 'testnet'
    else if (url_.includes('mainnet')) this._network = 'mainnet-beta'
  }

  recordAction(actionType: string, details: string, txSignature?: string, slot?: number): void {
    this._actions.push({
      timestamp: new Date().toISOString(),
      action_type: actionType,
      details,
      tx_signature: txSignature ?? null,
      slot: slot ?? null,
      latency_ms: 0,
    })
    // cap at 500
    if (this._actions.length > 500) this._actions.splice(0, this._actions.length - 500)
  }

  state(): AgentState {
    return {
      is_running: this._running,
      actions: [...this._actions],
      rpc_endpoint: this._rpcEndpoint,
      network: this._network,
      strategy: this._strategy.name,
    }
  }

  async start(): Promise<boolean> {
    if (this._running) return false
    this._running = true
    this._abortController = new AbortController()
    const signal = this._abortController.signal

    const mutable: MutableAgentState = {
      id: this.id,
      get rpcEndpoint() { return this._rpcEndpoint },
      get network() { return this._network },
      recordAction: this.recordAction.bind(this),
      snapshot: this.state.bind(this),
    } as unknown as MutableAgentState

    // Patch the mutable object with proper accessors
    Object.defineProperty(mutable, 'rpcEndpoint', { get: () => this._rpcEndpoint })
    Object.defineProperty(mutable, 'network', { get: () => this._network })

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

  stop(): boolean {
    if (!this._running) return false
    this._abortController?.abort()
    this._running = false
    return true
  }
}
