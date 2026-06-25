// Mirror of Rust AgentRole enum + RolePermissions.
// Controls what operations each agent is permitted to perform.

/**
 * Roles an agent can hold. Higher privilege roles unlock additional operations
 * (e.g. only `Leader` can stop other agents; only `Trader` can initiate payments).
 */
export enum AgentRole {
  /** Full control — can do everything including stop other agents. */
  Leader = 'leader',
  /** Manages workflows and assigns tasks; cannot create/delete agents. */
  Coordinator = 'coordinator',
  /** Default role. Can execute steps and modify shared state. */
  Worker = 'worker',
  /** Read-only observer that can broadcast but cannot modify state. */
  Monitor = 'monitor',
  /** Can read and write shared state; cannot execute steps. */
  Analyst = 'analyst',
  /** Can modify state and execute steps; can initiate payments. */
  Trader = 'trader',
}

/** Permission set derived from an agent's role. */
export interface RolePermissions {
  can_create_agents: boolean;
  can_delete_agents: boolean;
  can_send_messages: boolean;
  can_receive_messages: boolean;
  can_modify_shared_state: boolean;
  can_read_shared_state: boolean;
  can_create_workflows: boolean;
  can_execute_steps: boolean;
}

// Static permission table — one entry per role.
const PERMISSIONS: Record<AgentRole, RolePermissions> = {
  [AgentRole.Leader]: {
    can_create_agents: true, can_delete_agents: true, can_send_messages: true,
    can_receive_messages: true, can_modify_shared_state: true, can_read_shared_state: true,
    can_create_workflows: true, can_execute_steps: true,
  },
  [AgentRole.Coordinator]: {
    can_create_agents: false, can_delete_agents: false, can_send_messages: true,
    can_receive_messages: true, can_modify_shared_state: true, can_read_shared_state: true,
    can_create_workflows: true, can_execute_steps: true,
  },
  [AgentRole.Worker]: {
    can_create_agents: false, can_delete_agents: false, can_send_messages: true,
    can_receive_messages: true, can_modify_shared_state: false, can_read_shared_state: true,
    can_create_workflows: false, can_execute_steps: true,
  },
  [AgentRole.Monitor]: {
    can_create_agents: false, can_delete_agents: false, can_send_messages: true,
    can_receive_messages: true, can_modify_shared_state: false, can_read_shared_state: true,
    can_create_workflows: false, can_execute_steps: false,
  },
  [AgentRole.Analyst]: {
    can_create_agents: false, can_delete_agents: false, can_send_messages: true,
    can_receive_messages: true, can_modify_shared_state: true, can_read_shared_state: true,
    can_create_workflows: false, can_execute_steps: false,
  },
  [AgentRole.Trader]: {
    can_create_agents: false, can_delete_agents: false, can_send_messages: true,
    can_receive_messages: true, can_modify_shared_state: true, can_read_shared_state: true,
    can_create_workflows: false, can_execute_steps: true,
  },
}

/**
 * Returns the permission set for the given role.
 *
 * @example
 * const perms = getPermissions(AgentRole.Trader)
 * if (!perms.can_modify_shared_state) throw new Error('insufficient permissions')
 */
export function getPermissions(role: AgentRole): RolePermissions {
  return PERMISSIONS[role]
}
