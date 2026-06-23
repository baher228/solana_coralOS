// Mirror of Rust AgentRole enum + RolePermissions

export enum AgentRole {
  Leader = 'leader',
  Coordinator = 'coordinator',
  Worker = 'worker',
  Monitor = 'monitor',
  Analyst = 'analyst',
  Trader = 'trader',
}

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

export function getPermissions(role: AgentRole): RolePermissions {
  return PERMISSIONS[role]
}
