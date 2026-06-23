import type { AgentMessage } from './types.js'

const MAX_MESSAGES = 1000

export class MessageBus {
  private _messages: AgentMessage[] = []

  send(msg: AgentMessage): void {
    this._messages.push(msg)
    if (this._messages.length > MAX_MESSAGES) {
      this._messages.splice(0, this._messages.length - MAX_MESSAGES)
    }
  }

  broadcast(from: string, msgType: string, payload: string): void {
    this.send({
      id: crypto.randomUUID(),
      from, to: null, msg_type: msgType, payload,
      timestamp: new Date().toISOString(),
    })
  }

  direct(from: string, to: string, msgType: string, payload: string): void {
    this.send({
      id: crypto.randomUUID(),
      from, to, msg_type: msgType, payload,
      timestamp: new Date().toISOString(),
    })
  }

  getAll(): AgentMessage[] { return [...this._messages] }

  getFor(agentId: string): AgentMessage[] {
    return this._messages.filter(m => m.to === agentId || m.to === null)
  }

  getConversation(a: string, b: string): AgentMessage[] {
    return this._messages.filter(m =>
      (m.from === a && m.to === b) || (m.from === b && m.to === a)
    )
  }
}
