// Mirror of all Rust structs — identical field names (snake_case to match API responses).
// These types are shared between agent-runtime (runtime) and sdk (HTTP client).

/** A single event recorded in an agent's action log. */
export interface AgentAction {
  /** ISO 8601 timestamp of when the action occurred. */
  timestamp: string;
  /** Short identifier for the kind of action, e.g. `"poll-tick"`, `"payment-received"`. */
  action_type: string;
  /** Human-readable description of the action. */
  details: string;
  /** Solana transaction signature, if this action is tied to an on-chain event. */
  tx_signature: string | null;
  /** Solana slot number at the time of the action, if applicable. */
  slot: number | null;
  /** Wall-clock duration of the operation in milliseconds. */
  latency_ms: number;
}

/** Serialisable snapshot of an agent's runtime state. Safe to send over HTTP. */
export interface AgentState {
  /** Whether the agent's strategy loop is currently active. */
  is_running: boolean;
  /** Ordered action log (newest last). Capped at 500 entries. */
  actions: AgentAction[];
  /** Solana RPC endpoint the agent is using. */
  rpc_endpoint: string;
  /** Network label derived from `rpc_endpoint` (`"devnet"` | `"mainnet-beta"` | `"testnet"`). */
  network: string;
  /** `Strategy.name` of the currently attached strategy. */
  strategy: string;
}

/** Lightweight metadata stored alongside `AgentState` but excluded from action snapshots. */
export interface AgentMeta {
  /** The agent's current role string (matches `AgentRole` enum values). */
  role: string;
  /** ISO 8601 creation timestamp. */
  created_at: string;
  /** Free-form labels for filtering or grouping agents. */
  tags: string[];
}

/** A message delivered via the in-memory `MessageBus`. */
export interface AgentMessage {
  /** UUID v4 identifier. */
  id: string;
  /** Sender agent ID. */
  from: string;
  /** Recipient agent ID, or `null` for a broadcast visible to all agents. */
  to: string | null;
  /** Application-level message type, e.g. `"task-assigned"`, `"data-ready"`. */
  msg_type: string;
  /** Arbitrary string payload (often JSON). */
  payload: string;
  /** ISO 8601 timestamp of when the message was enqueued. */
  timestamp: string;
}

/** Current value of one key in the `SharedState` store. */
export interface SharedStateEntry {
  /** The stored value — any JSON-serialisable type. */
  value: unknown;
  /** ISO 8601 timestamp of the last write. */
  last_modified: string;
  /** ID of the agent (or system actor) that last wrote this key. */
  modified_by: string;
  /** Monotonically increasing write counter; starts at 1. */
  version: number;
}

/** One entry in the `SharedState` change history (audit log). */
export interface StateChange {
  /** The key that was written or deleted. */
  key: string;
  /** Previous value; `null` on the first write. */
  old_value: unknown | null;
  /** New value; `null` on deletion. */
  new_value: unknown;
  /** ISO 8601 timestamp of the change. */
  timestamp: string;
  /** Actor that made the change. */
  changed_by: string;
}

/** One step within a `Workflow` DAG. */
export interface WorkflowStep {
  /** Unique identifier within this workflow. */
  id: string;
  /** Short human-readable name. */
  name: string;
  /** Detailed description of what this step does. */
  description: string;
  /** Lifecycle status of this step. */
  status: 'Pending' | 'Assigned' | 'InProgress' | 'Completed' | 'Failed';
  /** Agent ID assigned to execute this step, or `null` if unassigned. */
  assigned_to: string | null;
  /** Step IDs that must be `Completed` before this step becomes ready. */
  dependencies: string[];
  /** Output string written on completion (or failure reason on `Failed`). */
  result: string | null;
  /** ISO 8601 timestamp set when status transitions to `InProgress`. */
  started_at: string | null;
  /** ISO 8601 timestamp set when status transitions to `Completed` or `Failed`. */
  completed_at: string | null;
  /** Optional timeout in seconds; enforcement is application-level. */
  timeout_secs: number | null;
}

/** A DAG-based workflow owned by the `WorkflowEngine`. */
export interface Workflow {
  /** Unique identifier. */
  id: string;
  name: string;
  description: string;
  /** Aggregate lifecycle status; automatically set to `"completed"` when all steps complete. */
  status: 'pending' | 'running' | 'completed' | 'failed';
  steps: WorkflowStep[];
  /** Index of the current step (informational; real ordering is from `dependencies`). */
  current_step: number;
  /** ISO 8601 creation timestamp. */
  created_at: string;
  /** ISO 8601 timestamp of the last state mutation. */
  updated_at: string;
  /** Agent ID that created the workflow. */
  created_by: string;
  /** Agent IDs that participate in this workflow. */
  assigned_agents: string[];
  /** Priority 1–10; higher means more important. */
  priority: number;
  /** Free-form labels. */
  tags: string[];
}

/** Result returned from `POST /api/v1/solana-pay/validate`. */
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

/** Parsed HTTP 402 payment challenge (MPP or x402 protocol). */
export interface PaymentChallenge {
  /** Protocol identifier: `"mpp"` or `"x402"`. */
  protocol: string;
  /** Requested payment amount in the token's smallest unit (lamports for SOL). */
  amount: number;
  /** Solana recipient public key (base58). */
  recipient: string;
  /** Token symbol, e.g. `"SOL"`, `"USDC"`. */
  token: string;
  memo: string | null;
  /** Unix timestamp (seconds) after which the challenge expires. */
  expires_at: number | null;
}
