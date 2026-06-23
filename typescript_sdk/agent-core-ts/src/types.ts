// Mirror of all Rust structs — identical field names (snake_case to match API responses)

export interface AgentAction {
  timestamp: string;        // ISO 8601
  action_type: string;
  details: string;
  tx_signature: string | null;
  slot: number | null;
  latency_ms: number;
}

export interface AgentState {
  is_running: boolean;
  actions: AgentAction[];
  rpc_endpoint: string;
  network: string;
  strategy: string;
}

export interface AgentMeta {
  role: string;
  created_at: string;
  tags: string[];
}

export interface AgentMessage {
  id: string;
  from: string;
  to: string | null;
  msg_type: string;
  payload: string;
  timestamp: string;
}

export interface SharedStateEntry {
  value: unknown;
  last_modified: string;
  modified_by: string;
  version: number;
}

export interface StateChange {
  key: string;
  old_value: unknown | null;
  new_value: unknown;
  timestamp: string;
  changed_by: string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  status: 'Pending' | 'Assigned' | 'InProgress' | 'Completed' | 'Failed';
  assigned_to: string | null;
  dependencies: string[];
  result: string | null;
  started_at: string | null;
  completed_at: string | null;
  timeout_secs: number | null;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  steps: WorkflowStep[];
  current_step: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  assigned_agents: string[];
  priority: number;
  tags: string[];
}

export interface ValidationResult {
  valid: boolean;
  signature: string;
  recipient_found: boolean;
  amount_transferred: number | null;
  token_mint: string | null;
  token_symbol: string | null;
  sender: string | null;
  description: string | null;
  slot: number | null;
  confirmations: number | null;
  timestamp: number | null;
  fee_lamports: number | null;
  error: string | null;
}

export interface PaymentChallenge {
  protocol: string;
  amount: number;
  recipient: string;
  token: string;
  memo: string | null;
  expires_at: number | null;
}
