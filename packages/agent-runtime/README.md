# @pay/agent-runtime

TypeScript multi-agent runtime that mirrors the Rust `agent-core` library concept-for-concept. Use this package to build and run Solana-aware agents entirely in Node.js or the browser. It pairs with `@pay/coral-client` (the HTTP client for coral-server) and with `CoralMcpAgent` for CoralOS MCP sessions.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Class: Agent](#class-agent)
- [Class: AgentManager](#class-agentmanager)
- [Class: MessageBus](#class-messagebus)
- [Class: SharedState](#class-sharedstate)
- [Class: WorkflowEngine](#class-workflowengine)
- [Strategy Interface](#strategy-interface)
- [Built-in Strategies](#built-in-strategies)
  - [IdleStrategy](#idlestrategy)
  - [RpcPollStrategy](#rpcpollstrategy)
  - [TransferStrategy](#transferstrategy)
  - [PaymentStrategy](#paymentstrategy)
  - [HeliusMonitorStrategy](#heliusmonitorstrategy)
- [Class: CoralMcpAgent](#class-coralmcpagent)
- [Class: CoralServerSync](#class-coralserversync)
- [Roles and Permissions](#roles-and-permissions)
- [TypeScript Interfaces](#typescript-interfaces)
- [Full Example](#full-example)

---

## Installation

```bash
npm install
npm run build     # compiles TypeScript → dist/
npm run dev       # watch mode
```

Dependencies pulled in automatically:

| Package | Purpose |
|---------|---------|
| `@solana/web3.js` | RPC connection, `PublicKey`, account subscription |
| `@solana/pay` | `encodeURL` for Solana Pay transfer URLs |
| `@modelcontextprotocol/sdk` | MCP client for CoralOS sessions |

---

## Quick Start

```typescript
import {
  AgentManager,
  RpcPollStrategy,
  AgentRole,
} from '@pay/agent-runtime'

const manager = new AgentManager()

// Create an agent with an RPC polling strategy
manager.createAgent('watcher', new RpcPollStrategy(5_000))

// Assign it the Monitor role
manager.setRole('watcher', AgentRole.Monitor)

// Start it — begins polling devnet every 5 s
await manager.startAgent('watcher')

// Read its state
const state = manager.getAgentState('watcher')
console.log(state?.actions.at(-1)) // last recorded action

// Stop cleanly
manager.stopAgent('watcher')
```

---

## Core Concepts

- **Agent** — holds one strategy and an action log. Start/stop it via `AbortController`.
- **Strategy** — async function that runs until the abort signal fires. Swap strategies at runtime.
- **AgentManager** — creates/stores/drives a collection of agents. Also owns a shared `MessageBus`, `SharedState`, and `WorkflowEngine`.
- **MessageBus** — in-memory broadcast and direct messaging between agents.
- **SharedState** — versioned key-value store accessible to all agents, with full change history.
- **WorkflowEngine** — DAG of `WorkflowStep`s. Steps are assigned to agents and transitioned through `Pending → Assigned → InProgress → Completed/Failed`.

All field names use **snake_case** to match the JSON API responses from coral-server.

---

## Class: Agent

```typescript
import { Agent } from '@pay/agent-runtime'
```

### Constructor

```typescript
new Agent(id: string, strategy: Strategy)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Unique identifier for this agent. |
| `strategy` | `Strategy` | Initial strategy to run. |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | `readonly string` | The agent's identifier. |
| `role` | `AgentRole` | Current role. Defaults to `AgentRole.Worker`. Set directly: `agent.role = AgentRole.Leader`. |
| `isRunning` | `readonly boolean` | Whether the strategy loop is currently active. |
| `strategy` | `readonly Strategy` | The currently attached strategy object. |

### Methods

#### `setStrategy(strategy: Strategy): void`

Replaces the strategy. Only takes effect on the next `start()` call — does not restart a running agent.

```typescript
agent.setStrategy(new RpcPollStrategy(10_000))
```

#### `setRpc(url: string): void`

Sets the RPC endpoint URL. Automatically infers `network` from the URL:
- URL contains `"devnet"` → `network = "devnet"`
- URL contains `"testnet"` → `network = "testnet"`
- URL contains `"mainnet"` → `network = "mainnet-beta"`

```typescript
agent.setRpc('https://devnet.helius-rpc.com/?api-key=MY_KEY')
```

#### `recordAction(actionType, details, txSignature?, slot?): void`

Appends an `AgentAction` to the agent's log. The log is capped at 500 entries (oldest are dropped). Timestamps are set to `new Date().toISOString()`.

```typescript
agent.recordAction('payment-received', 'received 0.5 SOL', 'sig123abc', 12345678)
```

| Parameter | Type | Required |
|-----------|------|----------|
| `actionType` | `string` | yes |
| `details` | `string` | yes |
| `txSignature` | `string` | no |
| `slot` | `number` | no |

#### `state(): AgentState`

Returns a snapshot of the agent's current state. The returned `actions` array is a shallow copy.

```typescript
const snap = agent.state()
// { is_running: true, actions: [...], rpc_endpoint: '...', network: 'devnet', strategy: 'rpc-poll' }
```

#### `async start(): Promise<boolean>`

Starts the strategy loop. Returns `true` if the agent was started, `false` if it was already running. The strategy runs on an `AbortController` signal — calling `stop()` aborts it cleanly.

```typescript
const started = await agent.start()
```

#### `stop(): boolean`

Aborts the running strategy and sets `isRunning` to `false`. Returns `true` if the agent was running, `false` if it was already stopped.

```typescript
agent.stop()
```

---

## Class: AgentManager

```typescript
import { AgentManager } from '@pay/agent-runtime'
```

The top-level orchestrator. Owns all agents plus shared infrastructure.

### Constructor

```typescript
new AgentManager()
```

No parameters. Creates empty internal state.

### Public Properties

| Property | Type | Description |
|----------|------|-------------|
| `bus` | `MessageBus` | Shared message bus for all agents. |
| `state` | `SharedState` | Shared key-value store for all agents. |
| `workflows` | `WorkflowEngine` | Workflow DAG engine. |

### Methods

#### `createAgent(id, strategy?): AgentState | null`

Creates a new agent and stores it. Returns the initial `AgentState`, or `null` if an agent with that `id` already exists. If `strategy` is omitted, a minimal idle strategy is used.

```typescript
const state = manager.createAgent('trader-1', new RpcPollStrategy())
if (!state) console.error('ID already taken')
```

#### `getAgent(id: string): Agent | undefined`

Returns the raw `Agent` object, or `undefined` if not found. Use for direct property access or calling methods not exposed on the manager.

#### `getAgentState(id: string): AgentState | null`

Returns a state snapshot for the given agent, or `null` if the agent does not exist.

```typescript
const s = manager.getAgentState('trader-1')
console.log(s?.is_running)
```

#### `listAgents(): Array<[string, AgentState]>`

Returns all agents as `[id, state]` tuples.

```typescript
for (const [id, state] of manager.listAgents()) {
  console.log(id, state.strategy, state.is_running)
}
```

#### `removeAgent(id: string): boolean`

Stops the agent (if running) and deletes it from the manager. Returns `false` if the agent was not found.

#### `setRpc(id: string, url: string): boolean`

Forwards to `agent.setRpc(url)`. Returns `false` if the agent is not found.

#### `setRole(id: string, role: AgentRole): boolean`

Sets the agent's role. Returns `false` if the agent is not found.

```typescript
manager.setRole('trader-1', AgentRole.Trader)
```

#### `async startAgent(id: string): Promise<boolean>`

Starts the agent. Returns `false` if not found or already running.

#### `stopAgent(id: string): boolean`

Stops the agent. Returns `false` if not found or already stopped.

#### `sendMessage(msg: AgentMessage): void`

Enqueues a fully-constructed `AgentMessage` onto the bus.

#### `broadcast(from, type, payload): void`

Convenience wrapper that creates a broadcast message (no `to` field).

```typescript
manager.broadcast('trader-1', 'status-update', JSON.stringify({ slot: 12345 }))
```

#### `direct(from, to, type, payload): void`

Convenience wrapper that creates a direct message.

```typescript
manager.direct('leader', 'worker-1', 'task-assignment', JSON.stringify({ task: 'poll' }))
```

#### `createWorkflow(workflow: Workflow): void`

Registers a workflow with the `WorkflowEngine`.

---

## Class: MessageBus

```typescript
import { MessageBus } from '@pay/agent-runtime'
```

In-memory ring buffer (max 1 000 messages) with broadcast and direct delivery semantics.

### Methods

#### `send(msg: AgentMessage): void`

Enqueues a fully-constructed message. You usually prefer `broadcast()` or `direct()`.

#### `broadcast(from, msgType, payload): void`

Creates and enqueues a message with `to: null`. All agents will see it in `getFor()`.

```typescript
bus.broadcast('leader', 'alert', 'market spike detected')
```

#### `direct(from, to, msgType, payload): void`

Creates and enqueues a message with a specific `to` field.

```typescript
bus.direct('leader', 'worker-3', 'task', JSON.stringify({ cmd: 'check-balance' }))
```

#### `getAll(): AgentMessage[]`

Returns a copy of all messages in the buffer, newest last.

#### `getFor(agentId: string): AgentMessage[]`

Returns all messages addressed to this agent (`to === agentId`) or broadcast messages (`to === null`).

```typescript
const inbox = bus.getFor('worker-3')
```

#### `getConversation(a: string, b: string): AgentMessage[]`

Returns all messages exchanged between agents `a` and `b` (in either direction).

```typescript
const thread = bus.getConversation('leader', 'worker-1')
```

---

## Class: SharedState

```typescript
import { SharedState } from '@pay/agent-runtime'
```

Versioned key-value store with a 500-entry change history. Values are typed as `unknown` to allow any JSON-serialisable data.

### Methods

#### `set(key, value, changedBy): boolean`

Creates or updates a key. Automatically increments `version`. Always returns `true`.

```typescript
state.set('market-price', { sol: 142.3, usdc: 1.0 }, 'analyst-1')
```

#### `get(key: string): SharedStateEntry | undefined`

Returns the entry for `key`, or `undefined` if the key does not exist.

```typescript
const entry = state.get('market-price')
console.log(entry?.value, entry?.version, entry?.modified_by)
```

#### `getAll(): Record<string, SharedStateEntry>`

Returns all entries as a plain object (suitable for JSON serialisation).

#### `delete(key, changedBy): boolean`

Removes a key and records the deletion in history. Returns `false` if the key did not exist.

```typescript
state.delete('stale-key', 'leader')
```

#### `history(): StateChange[]`

Returns a copy of all recorded changes (creates, updates, deletes), newest last.

```typescript
const changes = state.history()
changes.filter(c => c.key === 'market-price').forEach(c => {
  console.log(c.timestamp, c.old_value, '→', c.new_value)
})
```

---

## Class: WorkflowEngine

```typescript
import { WorkflowEngine } from '@pay/agent-runtime'
```

DAG workflow manager. Steps move through: `Pending → Assigned → InProgress → Completed | Failed`.

### Methods

#### `create(workflow: Workflow): void`

Registers a workflow. Stores a deep copy so external mutations don't affect internal state.

#### `get(id: string): Workflow | undefined`

Returns a deep copy of the workflow, or `undefined`.

#### `list(): Workflow[]`

Returns deep copies of all workflows.

#### `delete(id: string): boolean`

Removes a workflow. Returns `false` if not found.

#### `assignStep(workflowId, stepId, agentId): boolean`

Sets `step.assigned_to = agentId` and `step.status = 'Assigned'`. Returns `false` if workflow or step not found.

#### `startStep(workflowId, stepId): boolean`

Sets `step.status = 'InProgress'`, records `started_at`, and sets `workflow.status = 'running'`.

#### `completeStep(workflowId, stepId, result): boolean`

Sets `step.status = 'Completed'`, records `result` and `completed_at`. If all steps are completed, sets `workflow.status = 'completed'`.

#### `failStep(workflowId, stepId, reason): boolean`

Sets `step.status = 'Failed'`, records `reason` in `step.result`, and sets `workflow.status = 'failed'`.

#### `getActive(): Workflow[]`

Returns all workflows with `status === 'running'`.

#### `getForAgent(agentId: string): Workflow[]`

Returns all workflows where the agent appears in `assigned_agents` or is assigned to at least one step.

```typescript
const myWork = engine.getForAgent('worker-2')
```

---

## Strategy Interface

```typescript
import type { Strategy, MutableAgentState } from '@pay/agent-runtime'
```

Implement `Strategy` to define custom agent behaviour. The `run` method receives a view of the agent's mutable state and an `AbortSignal`. When the signal fires, the strategy must resolve its `Promise`.

```typescript
export interface Strategy {
  readonly name: string
  run(state: MutableAgentState, signal: AbortSignal): Promise<void>
}

export interface MutableAgentState {
  readonly id: string
  readonly rpcEndpoint: string
  readonly network: string
  recordAction(actionType: string, details: string, txSignature?: string, slot?: number): void
  snapshot(): AgentState
}
```

### Helper: `untilAborted(signal)`

```typescript
import { untilAborted } from '@pay/agent-runtime'
```

Returns a `Promise<void>` that resolves when the abort signal fires. Use this in strategy loops to wait without busy-spinning:

```typescript
await untilAborted(signal) // blocks until agent.stop() is called
```

### Implementing a Custom Strategy

```typescript
import type { Strategy, MutableAgentState } from '@pay/agent-runtime'
import { untilAborted } from '@pay/agent-runtime'

export class PriceCheckStrategy implements Strategy {
  readonly name = 'price-check'
  private symbol: string

  constructor(symbol: string) {
    this.symbol = symbol
  }

  async run(state: MutableAgentState, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const res = await fetch(`https://price-api.example.com/${this.symbol}`, { signal })
        const { price } = await res.json()
        state.recordAction('price-fetched', `${this.symbol}=${price}`)
      } catch (e) {
        if (!signal.aborted) state.recordAction('price-error', String(e))
      }
      // Wait 30 s but abort immediately if signalled
      await Promise.race([
        new Promise(r => setTimeout(r, 30_000)),
        untilAborted(signal),
      ])
    }
  }
}
```

---

## Built-in Strategies

### IdleStrategy

```typescript
import { IdleStrategy } from '@pay/agent-runtime'
new IdleStrategy()
```

Does nothing useful — records an `idle-tick` action every 60 seconds. Used as the default strategy when no strategy is provided to `AgentManager.createAgent()`.

**Behavior:** Runs `setInterval` at 60 s cadence, calls `state.recordAction('idle-tick', 'agent is idle')` each tick, and resolves when aborted.

---

### RpcPollStrategy

```typescript
import { RpcPollStrategy } from '@pay/agent-runtime'
new RpcPollStrategy(intervalMs?: number)
```

Polls the Solana RPC for the current slot on a fixed interval.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `intervalMs` | `number` | `10_000` | Milliseconds between polls. |

**Behavior:** Creates a `@solana/web3.js` `Connection` from `state.rpcEndpoint`. On each iteration calls `getSlot()` and records `poll-tick` with `slot=<N>`. On error records `poll-error`. Aborts cleanly between ticks.

```typescript
const strategy = new RpcPollStrategy(5_000)
manager.createAgent('slot-watcher', strategy)
manager.setRpc('slot-watcher', 'https://api.devnet.solana.com')
await manager.startAgent('slot-watcher')
```

---

### TransferStrategy

```typescript
import { TransferStrategy } from '@pay/agent-runtime'
import type { TransferConfig } from '@pay/agent-runtime'

new TransferStrategy(config: TransferConfig)
```

Generates a Solana Pay transfer URL using `@solana/pay`.

```typescript
export interface TransferConfig {
  recipient: string    // base58 public key
  amountSol: number   // SOL amount (not lamports)
  label?: string      // human-readable label shown in wallets
  message?: string    // human-readable message shown in wallets
}
```

**Behavior:** On `run()`, calls `encodeURL({ recipient, amount, label, message })` and records `url-generated` with the resulting URL string. Waits until aborted. Run once — it does not loop.

```typescript
const strategy = new TransferStrategy({
  recipient: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgRkr',
  amountSol: 0.1,
  label: 'Demo payment',
  message: 'Thanks for using pay.sh',
})
manager.createAgent('pay-agent', strategy)
await manager.startAgent('pay-agent')

// After start, inspect the generated URL:
const urlAction = manager.getAgentState('pay-agent')
  ?.actions.find(a => a.action_type === 'url-generated')
console.log(urlAction?.details) // solana:7xKXtg2...?amount=0.1&label=...
```

---

### PaymentStrategy

```typescript
import { PaymentStrategy } from '@pay/agent-runtime'
import type { PaymentConfig } from '@pay/agent-runtime'

new PaymentStrategy(config: PaymentConfig)
```

Polls an HTTP 402-gated endpoint and records payment challenges.

```typescript
export interface PaymentConfig {
  endpoint: string        // URL to poll
  budgetLamports: number  // maximum lamports agent is willing to pay
}
```

**Behavior:** Issues a `fetch()` to `endpoint`. On HTTP 402, parses the `WWW-Authenticate` header for MPP or x402 base64-encoded JSON blobs, records `payment-challenge` with the parsed `PaymentChallenge` JSON. On success (2xx), records `payment-success` and stops the loop. On error, records `payment-error`. Retries every 10 seconds.

The header parsing logic handles both:
- `WWW-Authenticate: mpp=<base64_json>`
- `WWW-Authenticate: x402=<base64_json>`

```typescript
const strategy = new PaymentStrategy({
  endpoint: 'https://debugger.pay.sh/mpp/quote/AAPL',
  budgetLamports: 1_000_000,
})
manager.createAgent('buyer', strategy)
await manager.startAgent('buyer')
```

---

### HeliusMonitorStrategy

```typescript
import { HeliusMonitorStrategy } from '@pay/agent-runtime'
import type { HeliusMonitorConfig } from '@pay/agent-runtime'

new HeliusMonitorStrategy(config: HeliusMonitorConfig)
```

Monitors a Solana account for incoming SOL payments using WebSocket account subscriptions.

```typescript
export interface HeliusMonitorConfig {
  recipient: string               // base58 public key to watch
  amountSol: number              // expected payment amount (for qualification check)
  apiKey?: string                // Helius API key (falls back to public devnet if omitted)
  network?: 'devnet' | 'mainnet-beta'  // default: 'devnet'
}
```

**Behavior:**
1. Constructs Helius RPC and WebSocket URLs from `apiKey` and `network`.
2. Fetches the baseline lamport balance of `recipient` via `getAccountInfo`.
3. Subscribes to account changes with `conn.onAccountChange()`.
4. On each change: computes `diff = newLamports - lastLamports`. Records `payment-received` if `diff >= expectedLamports`, or `partial-payment` if positive but below threshold.
5. On abort, removes the subscription with `removeAccountChangeListener`.

```typescript
const strategy = new HeliusMonitorStrategy({
  recipient: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgRkr',
  amountSol: 0.5,
  apiKey: process.env.HELIUS_API_KEY,
  network: 'devnet',
})
manager.createAgent('seller', strategy)
await manager.startAgent('seller')

// Poll for payment confirmation:
const actions = manager.getAgentState('seller')?.actions ?? []
const received = actions.find(a => a.action_type === 'payment-received')
```

---

## Class: CoralMcpAgent

```typescript
import { CoralMcpAgent } from '@pay/agent-runtime'
import type { CoralMcpConfig, CoralMention } from '@pay/agent-runtime'
```

Full MCP participant in CoralOS sessions. Mirrors the Python `coral_agent.py` pattern:  
`connect → list_tools → loop(waitForMention → handler → sendMessage)`.

### Interfaces

```typescript
export interface CoralMcpConfig {
  connectionUrl: string  // Full MCP endpoint, e.g. 'http://localhost:8001/mcp'
  agentName: string      // Identity presented to CoralOS
  version?: string       // Defaults to "1.0.0"
}

export interface CoralMention {
  threadId?: string   // CoralOS thread identifier
  sender?: string     // Name/ID of the sending agent
  text: string        // Raw JSON string from CoralOS
}
```

### Constructor

```typescript
new CoralMcpAgent(config: CoralMcpConfig)
```

### Methods

#### `async connect(): Promise<void>`

Creates an MCP `Client`, connects via `StreamableHTTPClientTransport`, and calls `listTools()` to discover the correct tool names (`wait_for_mention`, `send_message`). **Must be called before any other method.**

```typescript
const agent = new CoralMcpAgent({
  connectionUrl: process.env.CORAL_CONNECTION_URL!,
  agentName: 'ts-helius-monitor',
})
await agent.connect()
```

#### `async waitForMention(maxWaitMs?): Promise<CoralMention | null>`

Blocks until CoralOS delivers a mention, or returns `null` on timeout. `maxWaitMs` defaults to `30_000` (30 seconds), matching the Python agent.

The method parses the raw JSON from CoralOS, handling all known shapes:
- Top-level `{ threadId, senderName, ... }`
- Nested `{ messages: [{ threadId, senderName }] }`
- `{ message: { threadId, senderName } }`

Returns `null` for empty, `"null"`, `"{}"`, or `"[]"` responses.

#### `async sendMessage(content, threadId?, mentions?): Promise<void>`

Sends a message into a CoralOS thread.

| Parameter | Type | Description |
|-----------|------|-------------|
| `content` | `string` | Message body |
| `threadId` | `string` | Thread to reply in (pass `mention.threadId`) |
| `mentions` | `string[]` | Agent names to notify (pass `[mention.sender]`) |

#### `async runLoop(handler, signal?): Promise<void>`

Runs the standard CoralOS event loop:
1. Calls `waitForMention(30_000)`.
2. On timeout (null): loops back.
3. On mention: calls `handler(mention)` → awaits the response string → calls `sendMessage(response, mention.threadId, [mention.sender])`.
4. On error: logs and retries after 2 seconds.
5. Exits when `signal` is aborted.

```typescript
await agent.runLoop(async (mention) => {
  // Your agent logic here
  const result = await doWork(mention.text)
  return JSON.stringify({ result, from: mention.sender })
})
```

#### `async disconnect(): Promise<void>`

Closes the MCP client connection.

### Full Example

See `examples/coral_mcp_example.ts`:

```typescript
import { CoralMcpAgent } from '@pay/agent-runtime'

const agent = new CoralMcpAgent({
  connectionUrl: process.env.CORAL_CONNECTION_URL!,
  agentName: 'ts-helius-monitor',
})

await agent.connect()
console.error('Connected to CoralOS. Waiting for mentions...')

await agent.runLoop(async (mention) => {
  const result = {
    type: 'acknowledged',
    from: mention.sender,
    thread: mention.threadId,
    timestamp: new Date().toISOString(),
  }
  return JSON.stringify(result)
})
```

Run it:

```bash
CORAL_CONNECTION_URL=http://localhost:8001/mcp \
npx ts-node --esm examples/coral_mcp_example.ts
```

---

## Class: CoralServerSync

```typescript
import { CoralServerSync } from '@pay/agent-runtime'
```

Optional bridge that makes TypeScript agents visible in the coral-server UI and allows them to exchange messages with Rust agents over the HTTP API.

### Methods

#### `async attach(manager, coralUrl): Promise<void>`

1. Iterates all agents in `manager` and POSTs each to `POST /api/v1/agents` on `coralUrl` to register them.
2. Starts a 2-second polling loop that fetches `GET /api/v1/messages/<id>` for each agent and pushes any received messages onto `manager.bus`.

```typescript
const sync = new CoralServerSync()
await sync.attach(manager, 'http://localhost:8081')
```

#### `detach(): void`

Stops the polling interval.

```typescript
sync.detach()
```

---

## Roles and Permissions

```typescript
import { AgentRole, getPermissions } from '@pay/agent-runtime'
import type { RolePermissions } from '@pay/agent-runtime'
```

### `AgentRole` enum

| Value | String |
|-------|--------|
| `AgentRole.Leader` | `'leader'` |
| `AgentRole.Coordinator` | `'coordinator'` |
| `AgentRole.Worker` | `'worker'` |
| `AgentRole.Monitor` | `'monitor'` |
| `AgentRole.Analyst` | `'analyst'` |
| `AgentRole.Trader` | `'trader'` |

### `getPermissions(role): RolePermissions`

Returns the permission set for a role.

```typescript
const perms = getPermissions(AgentRole.Leader)
// {
//   can_create_agents: true, can_delete_agents: true,
//   can_send_messages: true, can_receive_messages: true,
//   can_modify_shared_state: true, can_read_shared_state: true,
//   can_create_workflows: true, can_execute_steps: true,
// }
```

### Permission matrix

| Role | create agents | delete agents | modify state | create workflows | execute steps |
|------|:---:|:---:|:---:|:---:|:---:|
| Leader | yes | yes | yes | yes | yes |
| Coordinator | no | no | yes | yes | yes |
| Worker | no | no | no | no | yes |
| Monitor | no | no | no | no | no |
| Analyst | no | no | yes | no | no |
| Trader | no | no | yes | no | yes |

All roles can send and receive messages and read shared state.

---

## TypeScript Interfaces

All interfaces use **snake_case** field names to match coral-server JSON responses.

```typescript
interface AgentAction {
  timestamp: string         // ISO 8601
  action_type: string       // e.g. 'poll-tick', 'payment-received'
  details: string           // human-readable description
  tx_signature: string | null
  slot: number | null
  latency_ms: number
}

interface AgentState {
  is_running: boolean
  actions: AgentAction[]
  rpc_endpoint: string
  network: string            // 'devnet' | 'testnet' | 'mainnet-beta'
  strategy: string           // strategy.name value
}

interface AgentMeta {
  role: string               // AgentRole string value
  created_at: string         // ISO 8601
  tags: string[]
}

interface AgentMessage {
  id: string                 // UUID
  from: string               // sender agent id
  to: string | null          // null = broadcast
  msg_type: string
  payload: string
  timestamp: string          // ISO 8601
}

interface SharedStateEntry {
  value: unknown             // any JSON value
  last_modified: string      // ISO 8601
  modified_by: string        // agent id that last wrote
  version: number            // increments on each write, starts at 1
}

interface StateChange {
  key: string
  old_value: unknown | null  // null on creation
  new_value: unknown         // null on deletion
  timestamp: string
  changed_by: string
}

interface WorkflowStep {
  id: string
  name: string
  description: string
  status: 'Pending' | 'Assigned' | 'InProgress' | 'Completed' | 'Failed'
  assigned_to: string | null
  dependencies: string[]     // step IDs that must complete first
  result: string | null
  started_at: string | null
  completed_at: string | null
  timeout_secs: number | null
}

interface Workflow {
  id: string
  name: string
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  steps: WorkflowStep[]
  current_step: number
  created_at: string
  updated_at: string
  created_by: string
  assigned_agents: string[]
  priority: number
  tags: string[]
}

interface ValidationResult {
  valid: boolean
  signature: string
  recipient_found: boolean
  amount_transferred: number | null
  token_mint: string | null
  token_symbol: string | null
  sender: string | null
  description: string | null
  slot: number | null
  confirmations: number | null
  timestamp: number | null
  fee_lamports: number | null
  error: string | null
}

interface PaymentChallenge {
  protocol: string     // 'mpp' | 'x402'
  amount: number
  recipient: string
  token: string
  memo: string | null
  expires_at: number | null
}
```

---

## Full Example

Create a manager with a seller (Helius monitor) and a buyer (RPC poller), wire up messaging, and run a basic payment flow:

```typescript
import {
  AgentManager,
  HeliusMonitorStrategy,
  RpcPollStrategy,
  AgentRole,
  CoralServerSync,
} from '@pay/agent-runtime'

const RECIPIENT = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgRkr'
const HELIUS_KEY = process.env.HELIUS_API_KEY ?? ''

async function main() {
  const manager = new AgentManager()

  // Create seller — monitors for incoming 0.1 SOL
  manager.createAgent(
    'seller',
    new HeliusMonitorStrategy({
      recipient: RECIPIENT,
      amountSol: 0.1,
      apiKey: HELIUS_KEY,
      network: 'devnet',
    }),
  )
  manager.setRole('seller', AgentRole.Trader)

  // Create buyer — polls slot and waits for instruction
  manager.createAgent('buyer', new RpcPollStrategy(8_000))
  manager.setRole('buyer', AgentRole.Worker)

  // Wire them to coral-server so the web UI can see them
  const sync = new CoralServerSync()
  await sync.attach(manager, 'http://localhost:8081')

  // Start both agents
  await manager.startAgent('seller')
  await manager.startAgent('buyer')

  // Broadcast a task from leader
  manager.broadcast('system', 'task', JSON.stringify({ cmd: 'await-payment', recipient: RECIPIENT }))

  // Poll until payment is confirmed
  const deadline = Date.now() + 5 * 60 * 1_000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2_000))
    const state = manager.getAgentState('seller')
    const received = state?.actions.find(a => a.action_type === 'payment-received')
    if (received) {
      console.log('Payment confirmed:', received.details)
      break
    }
  }

  // Clean up
  manager.stopAgent('seller')
  manager.stopAgent('buyer')
  sync.detach()
}

main().catch(console.error)
```
