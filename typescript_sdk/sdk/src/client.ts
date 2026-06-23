import type {
  AgentState, AgentMeta, AgentMessage, SharedStateEntry, StateChange,
  Workflow, WorkflowStep, PaymentFlowRecord,
} from './types.js'

export class CoralClient {
  private base: string

  constructor(baseUrl = 'http://localhost:8080') {
    this.base = baseUrl.replace(/\/$/, '')
  }

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

  listAgents(): Promise<Array<[string, AgentState]>> {
    return this.req('/api/v1/agents')
  }

  listAgentsWithRoles(): Promise<Array<[string, AgentState, AgentMeta]>> {
    return this.req('/api/v1/agents/with-roles')
  }

  createAgent(id: string): Promise<AgentState> {
    return this.req('/api/v1/agents', 'POST', { id })
  }

  getAgent(id: string): Promise<AgentState> {
    return this.req(`/api/v1/agents/${id}`)
  }

  deleteAgent(id: string): Promise<void> {
    return this.req(`/api/v1/agents/${id}`, 'DELETE')
  }

  startAgent(id: string): Promise<boolean> {
    return this.req(`/api/v1/agents/${id}/start`, 'POST')
  }

  stopAgent(id: string): Promise<boolean> {
    return this.req(`/api/v1/agents/${id}/stop`, 'POST')
  }

  setAgentRole(id: string, role: string): Promise<boolean> {
    return this.req(`/api/v1/agents/${id}/role`, 'POST', { role })
  }

  setAgentHelius(id: string, apiKey: string): Promise<boolean> {
    return this.req(`/api/v1/agents/${id}/helius`, 'POST', { api_key: apiKey })
  }

  setAgentRpc(id: string, url: string): Promise<boolean> {
    return this.req(`/api/v1/agents/${id}/rpc`, 'POST', { url })
  }

  createSolanaPayAgent(id: string, mode: 'Transfer' | 'Payment'): Promise<AgentState> {
    return this.req('/api/v1/agents/solana-pay', 'POST', { id, mode })
  }

  createHeliusMonitorAgent(params: {
    id: string, recipient: string, amount_sol: number, api_key: string, label?: string
  }): Promise<AgentState> {
    return this.req('/api/v1/agents/helius-monitor', 'POST', params)
  }

  // ── Messaging ──────────────────────────────────────────────────────────────

  getAllMessages(): Promise<AgentMessage[]> {
    return this.req('/api/v1/messages')
  }

  getMessages(agentId: string): Promise<AgentMessage[]> {
    return this.req(`/api/v1/messages/${agentId}`)
  }

  sendMessage(params: { from: string, to?: string, msg_type: string, payload: string }): Promise<boolean> {
    return this.req('/api/v1/messages', 'POST', params)
  }

  // ── Shared State ───────────────────────────────────────────────────────────

  getAllState(): Promise<Record<string, SharedStateEntry>> {
    return this.req('/api/v1/state')
  }

  getStateHistory(): Promise<StateChange[]> {
    return this.req('/api/v1/state/history')
  }

  setState(key: string, value: unknown, changedBy: string): Promise<boolean> {
    return this.req(`/api/v1/state/${key}`, 'POST', { value, changed_by: changedBy })
  }

  // ── Workflows ─────────────────────────────────────────────────────────────

  listWorkflows(): Promise<Workflow[]> {
    return this.req('/api/v1/workflows')
  }

  createWorkflow(params: {
    id: string, name: string, description: string,
    steps: WorkflowStep[], priority: number, created_by: string
  }): Promise<Workflow> {
    return this.req('/api/v1/workflows', 'POST', params)
  }

  assignStep(workflowId: string, stepId: string, agentId: string): Promise<boolean> {
    return this.req(`/api/v1/workflows/${workflowId}/steps/${stepId}/assign`, 'POST', { agent_id: agentId })
  }

  startStep(workflowId: string, stepId: string): Promise<boolean> {
    return this.req(`/api/v1/workflows/${workflowId}/steps/${stepId}/start`, 'POST')
  }

  completeStep(workflowId: string, stepId: string, result: string): Promise<boolean> {
    return this.req(`/api/v1/workflows/${workflowId}/steps/${stepId}/complete`, 'POST', { result })
  }

  // ── Solana Pay ─────────────────────────────────────────────────────────────

  createSolanaPayUrl(params: { recipient: string, amount: number, label?: string, message?: string }): Promise<string> {
    return this.req('/api/v1/solana-pay/url', 'POST', params)
  }

  parseSolanaPayUrl(url: string): Promise<unknown> {
    return this.req('/api/v1/solana-pay/parse', 'POST', { url })
  }

  validateTransaction(params: { id: string, signature: string, expected_recipient?: string }): Promise<unknown> {
    return this.req('/api/v1/solana-pay/validate', 'POST', params)
  }

  parse402Headers(headers: Array<[string, string]>): Promise<unknown> {
    return this.req('/api/v1/solana-pay/x402/parse', 'POST', { headers })
  }

  demoPayment(params: { endpoint: string, budget: number }): Promise<unknown> {
    return this.req('/api/v1/solana-pay/x402/demo', 'POST', params)
  }

  // ── Pay Demo ───────────────────────────────────────────────────────────────

  getPaymentFlows(): Promise<PaymentFlowRecord[]> {
    return this.req('/api/v1/pay-demo/flows')
  }

  completeSale(params: { seller_id: string, buyer_id: string, tx_signature?: string }): Promise<string> {
    return this.req('/api/v1/pay-demo/complete-sale', 'POST', params)
  }

  // ── CoralOS ────────────────────────────────────────────────────────────────

  setCoralOsConfig(params: { url?: string, token?: string }): Promise<boolean> {
    return this.req('/api/v1/coralos/config', 'PUT', params)
  }

  listCoralSessions(namespace: string): Promise<unknown[]> {
    return this.req(`/api/v1/coralos/sessions/${namespace}`)
  }

  // ── CoralOS MCP (direct streamable-HTTP, not proxied) ──────────────────────

  /** Ask coral-server to join a CoralOS MCP session as a background agent. */
  joinCoralMcpSession(params: { connection_url: string; agent_name: string }): Promise<boolean> {
    return this.req('/api/v1/coralos/mcp/join', 'POST', params)
  }

  /** Check if an MCP session is active for a given agent name. */
  getCoralMcpStatus(agentName: string): Promise<boolean> {
    return this.req(`/api/v1/coralos/mcp/status/${agentName}`)
  }
}
