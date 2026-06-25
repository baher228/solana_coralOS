import type { AgentMessage } from './types.js'

/** Maximum number of messages retained in memory. Oldest entries are evicted first. */
const MAX_MESSAGES = 1000

/**
 * In-memory broadcast and direct messaging bus shared across all agents in one `AgentManager`.
 *
 * A message is visible to agent `X` if:
 * - `to` is `null` (broadcast), **or**
 * - `from === X` (sent by X), **or**
 * - `to === X` (sent to X directly).
 */
export class MessageBus {
  private _messages: AgentMessage[] = []

  /**
   * Enqueue a fully-constructed message. Evicts the oldest entry when the buffer
   * exceeds `MAX_MESSAGES`.
   */
  send(msg: AgentMessage): void {
    this._messages.push(msg)
    if (this._messages.length > MAX_MESSAGES) {
      this._messages.splice(0, this._messages.length - MAX_MESSAGES)
    }
  }

  /**
   * Create and enqueue a broadcast message (visible to all agents).
   * @param from    - Sender agent ID.
   * @param msgType - Application-level message type.
   * @param payload - Arbitrary string payload (often JSON).
   */
  broadcast(from: string, msgType: string, payload: string): void {
    this.send({
      id: crypto.randomUUID(),
      from, to: null, msg_type: msgType, payload,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Create and enqueue a direct message addressed to a single agent.
   * @param from    - Sender agent ID.
   * @param to      - Recipient agent ID.
   * @param msgType - Application-level message type.
   * @param payload - Arbitrary string payload (often JSON).
   */
  direct(from: string, to: string, msgType: string, payload: string): void {
    this.send({
      id: crypto.randomUUID(),
      from, to, msg_type: msgType, payload,
      timestamp: new Date().toISOString(),
    })
  }

  /** Return a shallow copy of all messages in the buffer, oldest first. */
  getAll(): AgentMessage[] { return [...this._messages] }

  /**
   * Return all messages visible to `agentId` — broadcasts (`to === null`) and
   * messages directly addressed to this agent.
   */
  getFor(agentId: string): AgentMessage[] {
    return this._messages.filter(m => m.to === agentId || m.to === null)
  }

  /**
   * Return the direct-message thread between agents `a` and `b` in either direction.
   */
  getConversation(a: string, b: string): AgentMessage[] {
    return this._messages.filter(m =>
      (m.from === a && m.to === b) || (m.from === b && m.to === a)
    )
  }
}
