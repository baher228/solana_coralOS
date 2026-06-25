/**
 * `CoralClient` — typed HTTP wrapper for the `api-server` Express server.
 *
 * Exposes every `api-server` route as an async method. Instantiate with the server's
 * base URL and pass it around instead of calling `fetch` directly.
 *
 * @example
 * const client = new CoralClient('http://localhost:8081')
 * const agents = await client.listAgents()
 */

import type {
  AgentState, AgentMeta, AgentMessage, SharedStateEntry, StateChange,
  Workflow, WorkflowStep, PaymentFlowRecord,
} from './types.js'

export class CoralClient {
  private base: string

  /** @param baseUrl - Base URL of the `api-server` server. Defaults to `http://localhost:8081`. */
  constructor(baseUrl = 'http://localhost:8081') {
    this.base = baseUrl.replace(/\/$/, '')
  }

  /**
   * Internal fetch helper. Parses the response as JSON and throws on non-2xx status.
   * Returns `undefined` for `204 No Content` responses.
   */
  private async req<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`)
    if (res.status === 204) return undefined as unknown as T
    return res.json() as Promise<T>
  }

  // ── Agents ─────────────────────────────────────────────────────────────────

  /** Return all agents as `[id, AgentState]` pairs. */
  listAgents(): Promise<Array<[string, AgentState]>> {
    return this.req('/api/v1/agents')
  }

  /** Return agents with their associated role metadata (requires server-side support). */
  listAgentsWithRoles(): Promise<Array<[string, AgentState, AgentMeta]>> {
    return this.req('/api/v1/agents/with-roles')
  }

  /**
   * Create a new agent with an optional strategy.
   * @param id       - Unique agent identifier.
   * @param strategy - Strategy name (must be in the server's `REGISTRY`). Defaults to `"idle"`.
   * @param config   - Optional config object forwarded to the strategy factory.
   */
  createAgent(id: string, strategy?: string, config?: unknown): Promise<AgentState> {
    return this.req('/api/v1/agents', 'POST', { id, strategy, config })
  }

  /** Return the current `AgentState` for the given agent. */
  getAgent(id: string): Promise<AgentState> {
    return this.req(`/api/v1/agents/${id}`)
  }

  /** Stop and remove an agent. */
  deleteAgent(id: string): Promise<void> {
    return this.req(`/api/v1/agents/${id}`, 'DELETE')
  }

  /** Start the agent's strategy loop. Returns `false` if already running. */
  startAgent(id: string): Promise<boolean> {
    return this.req(`/api/v1/agents/${id}/start`, 'POST')
  }

  /** Abort the agent's strategy loop. Returns `false` if not running. */
  stopAgent(id: string): Promise<boolean> {
    return this.req(`/api/v1/agents/${id}/stop`, 'POST')
  }

  /** Set the agent's role (requires server-side route). */
  setAgentRole(id: string, role: string): Promise<boolean> {
    return this.req(`/api/v1/agents/${id}/role`, 'POST', { role })
  }

  /** Configure a Helius API key for the agent (requires server-side route). */
  setAgentHelius(id: string, apiKey: string): Promise<boolean> {
    return this.req(`/api/v1/agents/${id}/helius`, 'POST', { api_key: apiKey })
  }

  /** Override the agent's Solana RPC endpoint (requires server-side route). */
  setAgentRpc(id: string, url: string): Promise<boolean> {
    return this.req(`/api/v1/agents/${id}/rpc`, 'POST', { url })
  }

  /**
   * Dispatch a text message to an agent's strategy and return its response.
   * @param id   - Target agent ID.
   * @param text - Raw message text (often JSON).
   * @returns `{ reply: string }` with the strategy's response.
   */
  handleMessage(id: string, text: string): Promise<{ reply: string }> {
    return this.req(`/api/v1/agents/${id}/handle`, 'POST', { text })
  }

  // ── Messaging ──────────────────────────────────────────────────────────────

  /** Return all messages in the bus buffer. */
  getAllMessages(): Promise<AgentMessage[]> {
    return this.req('/api/v1/messages')
  }

  /** Return all messages visible to the given agent (direct + broadcasts). */
  getMessages(agentId: string): Promise<AgentMessage[]> {
    return this.req(`/api/v1/messages/${agentId}`)
  }

  /**
   * Enqueue a broadcast or direct message.
   * Omit `to` for a broadcast visible to all agents.
   */
  sendMessage(params: { from: string, to?: string, msg_type: string, payload: string }): Promise<boolean> {
    return this.req('/api/v1/messages', 'POST', params)
  }

  // ── Shared State ───────────────────────────────────────────────────────────

  /** Return all shared-state entries as `Record<string, SharedStateEntry>`. */
  getAllState(): Promise<Record<string, SharedStateEntry>> {
    return this.req('/api/v1/shared-state')
  }

  /** Return the shared-state change history (requires server-side route). */
  getStateHistory(): Promise<StateChange[]> {
    return this.req('/api/v1/shared-state/history')
  }

  /**
   * Write a value to the shared state.
   * @param key       - Arbitrary string key.
   * @param value     - Any JSON-serialisable value.
   * @param changedBy - Actor ID to record in the history log.
   */
  setState(key: string, value: unknown, changedBy: string): Promise<boolean> {
    return this.req(`/api/v1/shared-state/${key}`, 'POST', { value, changed_by: changedBy })
  }

  // ── Workflows ─────────────────────────────────────────────────────────────

  /** Return all registered workflows. */
  listWorkflows(): Promise<Workflow[]> {
    return this.req('/api/v1/workflows')
  }

  /** Create a new workflow. */
  createWorkflow(params: {
    id: string, name: string, description: string,
    steps: WorkflowStep[], priority: number, created_by: string
  }): Promise<Workflow> {
    return this.req('/api/v1/workflows', 'POST', params)
  }

  /** Assign `agentId` to a workflow step and transition it to `Assigned`. */
  assignStep(workflowId: string, stepId: string, agentId: string): Promise<boolean> {
    return this.req(`/api/v1/workflows/${workflowId}/steps/${stepId}/assign`, 'POST', { agent_id: agentId })
  }

  /** Transition a step to `InProgress`. */
  startStep(workflowId: string, stepId: string): Promise<boolean> {
    return this.req(`/api/v1/workflows/${workflowId}/steps/${stepId}/start`, 'POST')
  }

  /** Mark a step as `Completed` and record its result. */
  completeStep(workflowId: string, stepId: string, result: string): Promise<boolean> {
    return this.req(`/api/v1/workflows/${workflowId}/steps/${stepId}/complete`, 'POST', { result })
  }

  // ── Solana Pay ─────────────────────────────────────────────────────────────

  /** Generate a `solana:` pay URL (requires server-side route). */
  createSolanaPayUrl(params: { recipient: string, amount: number, label?: string, message?: string }): Promise<string> {
    return this.req('/api/v1/solana-pay/url', 'POST', params)
  }

  /** Parse a `solana:` URL into its components (requires server-side route). */
  parseSolanaPayUrl(url: string): Promise<unknown> {
    return this.req('/api/v1/solana-pay/parse', 'POST', { url })
  }

  /** Validate an on-chain transaction signature (requires server-side route). */
  validateTransaction(params: { id: string, signature: string, expected_recipient?: string }): Promise<unknown> {
    return this.req('/api/v1/solana-pay/validate', 'POST', params)
  }

  // ── Weather ────────────────────────────────────────────────────────────────

  /**
   * Fetch live weather data via the server's Open-Meteo proxy.
   * @param params - `{ city }` or `{ lat, lon }`.
   */
  getWeather(params: { city?: string; lat?: number; lon?: number }): Promise<{ ok: boolean; data: unknown; latency_ms: number }> {
    return this.req('/api/v1/weather', 'POST', params)
  }

  // ── Payment Flow Records ───────────────────────────────────────────────────

  /** Return all payment flow records (requires server-side route). */
  getPaymentFlows(): Promise<PaymentFlowRecord[]> {
    return this.req('/api/v1/pay-demo/flows')
  }

  // ── CoralOS MCP ────────────────────────────────────────────────────────────

  /** Ask the server to join a CoralOS MCP session as a background agent (requires server-side route). */
  joinCoralMcpSession(params: { connection_url: string; agent_name: string }): Promise<boolean> {
    return this.req('/api/v1/coralos/mcp/join', 'POST', params)
  }

  /** Check if an MCP session is active for the given agent name (requires server-side route). */
  getCoralMcpStatus(agentName: string): Promise<boolean> {
    return this.req(`/api/v1/coralos/mcp/status/${agentName}`)
  }
}
