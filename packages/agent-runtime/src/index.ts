export * from './types.js'
export * from './role.js'
export * from './strategy.js'   // includes Strategy interface + BaseStrategy
export { Agent } from './agent.js'
export { AgentManager } from './manager.js'
export { MessageBus } from './message_bus.js'
export { SharedState } from './shared_state.js'
export { WorkflowEngine } from './workflow.js'
export { CoralServerSync } from './sync.js'
export { log } from './log.js'

// Strategies
export { IdleStrategy } from './strategies/idle.js'
export { RpcPollStrategy } from './strategies/rpc_poll.js'
export { TransferStrategy } from './strategies/transfer.js'
export { PaymentStrategy } from './strategies/payment.js'
export { HeliusMonitorStrategy } from './strategies/helius_monitor.js'
export { WeatherStrategy } from './strategies/weather.js'

// CoralOS MCP client
export { CoralMcpAgent } from './coral_mcp.js'
export type { CoralMention, CoralMcpConfig } from './coral_mcp.js'

// Standalone CoralOS agent entrypoint (for Docker containers)
export { startCoralAgent } from './coral_mcp_server.js'
export type { CoralAgentConfig, CoralAgentContext } from './coral_mcp_server.js'
