import { Agent } from './agent.js'
import { MessageBus } from './message_bus.js'
import { SharedState } from './shared_state.js'
import { WorkflowEngine } from './workflow.js'
import type { Strategy } from './strategy.js'
import { IdleStrategy } from './strategies/idle.js'
import type { AgentState, AgentMessage, Workflow } from './types.js'
import { AgentRole } from './role.js'

/**
 * Top-level orchestrator. Creates, stores, and drives a collection of `Agent` instances.
 * Also owns the shared `MessageBus`, `SharedState`, and `WorkflowEngine` — all three are
 * accessible on public properties so strategies can interact with them directly.
 *
 * One `AgentManager` per process. Do not run multiple managers in the same Node.js
 * process unless you intentionally want isolated message buses and state stores.
 */
export class AgentManager {
  private _agents = new Map<string, Agent>()

  /** Shared message bus. All agents in this manager write to and read from the same bus. */
  readonly bus = new MessageBus()

  /** Shared key-value store. All agents in this manager share the same state. */
  readonly state = new SharedState()

  /** Shared workflow DAG engine. */
  readonly workflows = new WorkflowEngine()

  /**
   * Create a new agent and store it. If `strategy` is omitted, an `IdleStrategy` is used.
   * @returns The initial `AgentState` snapshot, or `null` if `id` is already taken.
   */
  createAgent(id: string, strategy?: Strategy): AgentState | null {
    if (this._agents.has(id)) return null
    const agent = new Agent(id, strategy ?? new IdleStrategy())
    this._agents.set(id, agent)
    return agent.state()
  }

  /** Return the raw `Agent` object, or `undefined` if not found. */
  getAgent(id: string): Agent | undefined { return this._agents.get(id) }

  /** Return a state snapshot for the given agent, or `null` if not found. */
  getAgentState(id: string): AgentState | null {
    return this._agents.get(id)?.state() ?? null
  }

  /** Return all agents as `[id, state]` tuples. */
  listAgents(): Array<[string, AgentState]> {
    return [...this._agents.entries()].map(([id, a]) => [id, a.state()])
  }

  /**
   * Stop the agent (if running) and remove it from the manager.
   * @returns `false` if the agent was not found.
   */
  removeAgent(id: string): boolean {
    const a = this._agents.get(id)
    if (!a) return false
    a.stop()
    this._agents.delete(id)
    return true
  }

  /**
   * Override the agent's Solana RPC endpoint.
   * @returns `false` if the agent is not found.
   */
  setRpc(id: string, url: string): boolean {
    const a = this._agents.get(id)
    if (!a) return false
    a.setRpc(url)
    return true
  }

  /**
   * Set the agent's role.
   * @returns `false` if the agent is not found.
   */
  setRole(id: string, role: AgentRole): boolean {
    const a = this._agents.get(id)
    if (!a) return false
    a.role = role
    return true
  }

  /**
   * Start the agent's strategy loop.
   * @returns `false` if the agent is not found or is already running.
   */
  async startAgent(id: string): Promise<boolean> {
    const a = this._agents.get(id)
    if (!a) return false
    return a.start()
  }

  /**
   * Stop the agent's strategy loop.
   * @returns `false` if the agent is not found or not running.
   */
  stopAgent(id: string): boolean {
    return this._agents.get(id)?.stop() ?? false
  }

  /** Enqueue a fully-constructed message onto the shared bus. */
  sendMessage(msg: AgentMessage): void {
    this.bus.send(msg)
  }

  /**
   * Create and enqueue a broadcast message (visible to all agents).
   * @param from    - Sender agent ID.
   * @param type    - Application-level message type.
   * @param payload - Arbitrary string payload.
   */
  broadcast(from: string, type: string, payload: string): void {
    this.bus.broadcast(from, type, payload)
  }

  /**
   * Create and enqueue a direct message to a specific agent.
   * @param from    - Sender agent ID.
   * @param to      - Recipient agent ID.
   * @param type    - Application-level message type.
   * @param payload - Arbitrary string payload.
   */
  direct(from: string, to: string, type: string, payload: string): void {
    this.bus.direct(from, to, type, payload)
  }

  /** Register a workflow with the shared `WorkflowEngine`. */
  createWorkflow(workflow: Workflow): void {
    this.workflows.create(workflow)
  }

  /**
   * Deliver a message to a named agent's strategy and return its response.
   * @returns The strategy's response string, or `null` if the agent is not found.
   */
  async handleMessage(id: string, text: string): Promise<string | null> {
    return this._agents.get(id)?.handleMessage(text) ?? null
  }
}
