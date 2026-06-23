import { Agent } from './agent.js'
import { MessageBus } from './message_bus.js'
import { SharedState } from './shared_state.js'
import { WorkflowEngine } from './workflow.js'
import type { Strategy } from './strategy.js'
import type { AgentState, AgentMessage, Workflow } from './types.js'
import { AgentRole } from './role.js'

export class AgentManager {
  private _agents = new Map<string, Agent>()
  readonly bus = new MessageBus()
  readonly state = new SharedState()
  readonly workflows = new WorkflowEngine()

  createAgent(id: string, strategy?: Strategy): AgentState | null {
    if (this._agents.has(id)) return null
    const agent = new Agent(id, strategy ?? new IdleStrategy())
    this._agents.set(id, agent)
    return agent.state()
  }

  getAgent(id: string): Agent | undefined { return this._agents.get(id) }

  getAgentState(id: string): AgentState | null {
    return this._agents.get(id)?.state() ?? null
  }

  listAgents(): Array<[string, AgentState]> {
    return [...this._agents.entries()].map(([id, a]) => [id, a.state()])
  }

  removeAgent(id: string): boolean {
    const a = this._agents.get(id)
    if (!a) return false
    a.stop()
    this._agents.delete(id)
    return true
  }

  setRpc(id: string, url: string): boolean {
    const a = this._agents.get(id)
    if (!a) return false
    a.setRpc(url)
    return true
  }

  setRole(id: string, role: AgentRole): boolean {
    const a = this._agents.get(id)
    if (!a) return false
    a.role = role
    return true
  }

  async startAgent(id: string): Promise<boolean> {
    const a = this._agents.get(id)
    if (!a) return false
    return a.start()
  }

  stopAgent(id: string): boolean {
    return this._agents.get(id)?.stop() ?? false
  }

  sendMessage(msg: AgentMessage): void {
    this.bus.send(msg)
  }

  broadcast(from: string, type: string, payload: string): void {
    this.bus.broadcast(from, type, payload)
  }

  direct(from: string, to: string, type: string, payload: string): void {
    this.bus.direct(from, to, type, payload)
  }

  createWorkflow(workflow: Workflow): void {
    this.workflows.create(workflow)
  }
}

class IdleStrategy implements Strategy {
  name = 'idle'
  async run(_state: unknown, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve) => {
      const tick = setInterval(() => {}, 1000)
      signal.addEventListener('abort', () => { clearInterval(tick); resolve() }, { once: true })
    })
  }
}
