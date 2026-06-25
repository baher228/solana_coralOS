// Re-export all shared types from agent-runtime inline (no peer dep for portability)

export interface CoralMention {
  threadId?: string
  sender?: string
  text: string
}

export interface AgentAction {
  timestamp: string
  action_type: string
  details: string
  tx_signature: string | null
  slot: number | null
  latency_ms: number
}

export interface AgentState {
  is_running: boolean
  actions: AgentAction[]
  rpc_endpoint: string
  network: string
  strategy: string
}

export interface AgentMeta {
  role: string
  created_at: string
  tags: string[]
}

export interface AgentMessage {
  id: string
  from: string
  to: string | null
  msg_type: string
  payload: string
  timestamp: string
}

export interface SharedStateEntry {
  value: unknown
  last_modified: string
  modified_by: string
  version: number
}

export interface StateChange {
  key: string
  old_value: unknown | null
  new_value: unknown
  timestamp: string
  changed_by: string
}

export interface WorkflowStep {
  id: string
  name: string
  description: string
  status: string
  assigned_to: string | null
  dependencies: string[]
  result: string | null
  started_at: string | null
  completed_at: string | null
  timeout_secs: number | null
}

export interface Workflow {
  id: string
  name: string
  description: string
  status: string
  steps: WorkflowStep[]
  current_step: number
  created_at: string
  updated_at: string
  created_by: string
  assigned_agents: string[]
  priority: number
  tags: string[]
}

export interface PaymentFlowRecord {
  id: string
  agent_id: string
  endpoint: string
  status: string
  protocol: string | null
  amount: number | null
  recipient: string | null
  token: string | null
  payment_header: string | null
  response_body: string | null
  error: string | null
  request_at: string
  challenge_at: string | null
  payment_at: string | null
  delivery_at: string | null
}
