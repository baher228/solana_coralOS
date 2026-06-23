# @pay/sdk

Typed HTTP client for [coral-server](../../coral-server) — the Axum REST API wrapping `agent-core`. Every endpoint on `coral-server` is exposed as a typed method. Zero runtime dependencies: `@pay/sdk` uses the built-in `fetch` API only.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Class: CoralClient](#class-coralclient)
  - [Constructor](#constructor)
  - [Agent Methods](#agent-methods)
  - [Messaging Methods](#messaging-methods)
  - [Shared State Methods](#shared-state-methods)
  - [Workflow Methods](#workflow-methods)
  - [Solana Pay Methods](#solana-pay-methods)
  - [Pay Demo Methods](#pay-demo-methods)
  - [CoralOS Methods](#coralos-methods)
- [Exported Types](#exported-types)
- [Payment Flow Example](#payment-flow-example)

---

## Installation

```bash
cd typescript_sdk/sdk
npm install
npm run build
```

Then import in another package:

```typescript
import { CoralClient } from '@pay/sdk'
```

Or directly:

```typescript
import { CoralClient } from '../typescript_sdk/sdk/src/index.js'
```

---

## Quick Start

```typescript
import { CoralClient } from '@pay/sdk'

const client = new CoralClient({ baseUrl: 'http://localhost:8080' })

// Create an agent and start it
await client.createAgent('trader-1')
await client.startAgent('trader-1')

// Send it a message
await client.sendMessage({ from: 'system', msg_type: 'init', payload: '{}' })

// Check its state
const state = await client.getAgent('trader-1')
console.log(state.is_running, state.strategy, state.actions.length)
```

---

## Class: CoralClient

```typescript
import { CoralClient } from '@pay/sdk'
```

### Constructor

```typescript
new CoralClient(baseUrl?: string)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `baseUrl` | `string` | `'http://localhost:8080'` | Base URL of coral-server. Trailing slash is stripped automatically. |

```typescript
const client = new CoralClient('http://localhost:8080')
const remoteClient = new CoralClient('https://coral.example.com')
```

All methods throw an `Error` with the message `"METHOD /path → STATUS"` on non-2xx responses. HTTP 204 responses return `undefined` cast to the expected type.

---

## Agent Methods

### `listAgents(): Promise<Array<[string, AgentState]>>`

Returns all agents as `[id, state]` tuples. Calls `GET /api/v1/agents`.

```typescript
const agents = await client.listAgents()
for (const [id, state] of agents) {
  console.log(id, state.is_running ? 'running' : 'stopped')
}
```

---

### `listAgentsWithRoles(): Promise<Array<[string, AgentState, AgentMeta]>>`

Like `listAgents()` but includes role metadata. Calls `GET /api/v1/agents/with-roles`.

```typescript
const list = await client.listAgentsWithRoles()
for (const [id, state, meta] of list) {
  console.log(id, meta.role, meta.tags)
}
```

---

### `createAgent(id: string): Promise<AgentState>`

Creates a new agent with an idle strategy. Calls `POST /api/v1/agents` with body `{ id }`. Returns the initial state.

```typescript
const state = await client.createAgent('my-agent')
// state.is_running === false, state.strategy === 'idle'
```

---

### `getAgent(id: string): Promise<AgentState>`

Returns current state of one agent. Calls `GET /api/v1/agents/:id`.

```typescript
const state = await client.getAgent('my-agent')
const lastAction = state.actions.at(-1)
```

---

### `deleteAgent(id: string): Promise<void>`

Stops (if running) and removes the agent. Calls `DELETE /api/v1/agents/:id`. Returns `void` (HTTP 204).

```typescript
await client.deleteAgent('my-agent')
```

---

### `startAgent(id: string): Promise<boolean>`

Starts the agent's strategy loop. Returns `true` on success, `false` if already running. Calls `POST /api/v1/agents/:id/start`.

```typescript
const started = await client.startAgent('my-agent')
```

---

### `stopAgent(id: string): Promise<boolean>`

Stops the agent. Returns `true` if it was running. Calls `POST /api/v1/agents/:id/stop`.

```typescript
await client.stopAgent('my-agent')
```

---

### `setAgentRole(id, role): Promise<boolean>`

Sets the agent's role string. Valid values: `'leader'`, `'coordinator'`, `'worker'`, `'monitor'`, `'analyst'`, `'trader'`. Calls `POST /api/v1/agents/:id/role` with body `{ role }`.

```typescript
await client.setAgentRole('trader-1', 'trader')
```

---

### `setAgentHelius(id, apiKey): Promise<boolean>`

Configures a Helius API key on the agent, enabling Helius-enhanced RPC. Calls `POST /api/v1/agents/:id/helius` with body `{ api_key }`.

```typescript
await client.setAgentHelius('monitor-1', process.env.HELIUS_API_KEY!)
```

---

### `setAgentRpc(id, url): Promise<boolean>`

Overrides the agent's RPC endpoint URL. Calls `POST /api/v1/agents/:id/rpc` with body `{ url }`.

```typescript
await client.setAgentRpc('my-agent', 'https://mainnet.helius-rpc.com/?api-key=KEY')
```

---

### `createSolanaPayAgent(id, mode): Promise<AgentState>`

Creates an agent pre-configured with a Solana Pay strategy. Calls `POST /api/v1/agents/solana-pay`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Agent identifier |
| `mode` | `'Transfer' \| 'Payment'` | `Transfer` generates payment URLs; `Payment` polls 402 endpoints |

```typescript
const state = await client.createSolanaPayAgent('pay-agent', 'Transfer')
```

---

### `createHeliusMonitorAgent(params): Promise<AgentState>`

Creates an agent that monitors a Solana address for incoming payments using Helius. Calls `POST /api/v1/agents/helius-monitor`.

```typescript
const state = await client.createHeliusMonitorAgent({
  id: 'seller-monitor',
  recipient: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgRkr',
  amount_sol: 0.5,
  api_key: process.env.HELIUS_API_KEY!,
  label: 'DataFeed sale',  // optional
})
await client.startAgent('seller-monitor')
```

---

## Messaging Methods

### `getAllMessages(): Promise<AgentMessage[]>`

Returns all messages in the bus. Calls `GET /api/v1/messages`.

```typescript
const msgs = await client.getAllMessages()
const broadcasts = msgs.filter(m => m.to === null)
```

---

### `getMessages(agentId: string): Promise<AgentMessage[]>`

Returns messages addressed to (or broadcast for) a specific agent. Calls `GET /api/v1/messages/:id`.

```typescript
const inbox = await client.getMessages('worker-1')
```

---

### `sendMessage(params): Promise<boolean>`

Sends a message onto the bus. Calls `POST /api/v1/messages`.

```typescript
// Broadcast
await client.sendMessage({
  from: 'leader',
  msg_type: 'alert',
  payload: JSON.stringify({ level: 'high', msg: 'rebalance now' }),
})

// Direct
await client.sendMessage({
  from: 'leader',
  to: 'worker-2',
  msg_type: 'task',
  payload: JSON.stringify({ cmd: 'check-balance' }),
})
```

| Field | Type | Required |
|-------|------|----------|
| `from` | `string` | yes |
| `to` | `string` | no (omit for broadcast) |
| `msg_type` | `string` | yes |
| `payload` | `string` | yes |

---

## Shared State Methods

### `getAllState(): Promise<Record<string, SharedStateEntry>>`

Returns the entire shared state store. Calls `GET /api/v1/state`.

```typescript
const store = await client.getAllState()
const price = store['market-price']?.value
```

---

### `getStateHistory(): Promise<StateChange[]>`

Returns all recorded state changes (creates, updates, deletes). Calls `GET /api/v1/state/history`.

```typescript
const history = await client.getStateHistory()
const priceChanges = history.filter(c => c.key === 'market-price')
```

---

### `setState(key, value, changedBy): Promise<boolean>`

Creates or updates a key. Calls `POST /api/v1/state/:key` with body `{ value, changed_by }`.

```typescript
await client.setState(
  'market-price',
  { sol: 142.3, usdc: 1.0 },
  'analyst-1',
)
```

---

## Workflow Methods

### `listWorkflows(): Promise<Workflow[]>`

Returns all workflows. Calls `GET /api/v1/workflows`.

---

### `createWorkflow(params): Promise<Workflow>`

Creates a new workflow. Calls `POST /api/v1/workflows`.

```typescript
const wf = await client.createWorkflow({
  id: 'wf-payment-001',
  name: 'Payment Flow',
  description: 'Full buy/sell cycle',
  steps: [
    {
      id: 'step-0',
      name: 'Generate payment URL',
      description: 'Seller creates Solana Pay URL',
      status: 'Pending',
      assigned_to: null,
      dependencies: [],
      result: null,
      started_at: null,
      completed_at: null,
      timeout_secs: 30,
    },
    {
      id: 'step-1',
      name: 'Confirm payment',
      description: 'Monitor confirms SOL received',
      status: 'Pending',
      assigned_to: null,
      dependencies: ['step-0'],
      result: null,
      started_at: null,
      completed_at: null,
      timeout_secs: 300,
    },
  ],
  priority: 5,
  created_by: 'user',
})
```

---

### `assignStep(workflowId, stepId, agentId): Promise<boolean>`

Assigns a step to an agent. Calls `POST /api/v1/workflows/:wfId/steps/:stepId/assign` with body `{ agent_id }`.

```typescript
await client.assignStep('wf-payment-001', 'step-0', 'pay-agent')
await client.assignStep('wf-payment-001', 'step-1', 'seller-monitor')
```

---

### `startStep(workflowId, stepId): Promise<boolean>`

Marks a step as `InProgress`. Calls `POST /api/v1/workflows/:wfId/steps/:stepId/start`.

```typescript
await client.startStep('wf-payment-001', 'step-0')
```

---

### `completeStep(workflowId, stepId, result): Promise<boolean>`

Marks a step as `Completed` with a result string. Calls `POST /api/v1/workflows/:wfId/steps/:stepId/complete` with body `{ result }`.

```typescript
await client.completeStep('wf-payment-001', 'step-0', urlAction.details)
```

---

## Solana Pay Methods

### `createSolanaPayUrl(params): Promise<string>`

Generates a `solana:` URL. Calls `POST /api/v1/solana-pay/url`.

```typescript
const url = await client.createSolanaPayUrl({
  recipient: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgRkr',
  amount: 0.1,
  label: 'My Store',
  message: 'Order #42',
})
// "solana:7xKXtg...?amount=0.1&label=My+Store&message=Order+%2342"
```

---

### `parseSolanaPayUrl(url: string): Promise<unknown>`

Parses a `solana:` URL into its components. Calls `POST /api/v1/solana-pay/parse` with body `{ url }`.

```typescript
const parsed = await client.parseSolanaPayUrl(
  'solana:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgRkr?amount=0.1'
)
```

---

### `validateTransaction(params): Promise<unknown>`

Validates that a Solana transaction matches an expected payment. Calls `POST /api/v1/solana-pay/validate`.

```typescript
const result = await client.validateTransaction({
  id: 'pay-agent',
  signature: '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLiReqWtkR3osVcZ',
  expected_recipient: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgRkr',
})
// { valid: true, amount_transferred: 0.1, slot: 123456, ... }
```

---

### `parse402Headers(headers): Promise<unknown>`

Parses `WWW-Authenticate` headers from an HTTP 402 response into a `PaymentChallenge`. Calls `POST /api/v1/solana-pay/x402/parse` with body `{ headers }`.

```typescript
const challenge = await client.parse402Headers([
  ['www-authenticate', 'mpp=eyJwcm90b2NvbCI6Im1wcCIsImFtb3VudCI6MTAwMH0='],
])
// { protocol: 'mpp', amount: 1000, recipient: '...', token: 'USDC' }
```

---

### `demoPayment(params): Promise<unknown>`

Triggers a demo payment flow against a live 402-gated endpoint. Calls `POST /api/v1/solana-pay/x402/demo`.

```typescript
const result = await client.demoPayment({
  endpoint: 'https://debugger.pay.sh/mpp/quote/AAPL',
  budget: 1_000_000,   // lamports
})
```

---

## Pay Demo Methods

### `getPaymentFlows(): Promise<PaymentFlowRecord[]>`

Returns all recorded payment flow events. Used by the Payment Flows tab in the UI to display the full lifecycle of each payment attempt. Calls `GET /api/v1/pay-demo/flows`.

```typescript
const flows = await client.getPaymentFlows()
const completed = flows.filter(f => f.status === 'delivered')
```

---

### `completeSale(params): Promise<string>`

Marks a sale as complete and returns the gated data payload. Calls `POST /api/v1/pay-demo/complete-sale`.

| Field | Type | Required |
|-------|------|----------|
| `seller_id` | `string` | yes |
| `buyer_id` | `string` | yes |
| `tx_signature` | `string` | no |

```typescript
const data = await client.completeSale({
  seller_id: 'pd-seller',
  buyer_id: 'pd-buyer',
  tx_signature: '5VERv8NM...',
})
console.log('Received data:', data)
```

---

## CoralOS Methods

### `setCoralOsConfig(params): Promise<boolean>`

Sets the URL and/or token for the CoralOS server connection. Calls `PUT /api/v1/coralos/config`.

```typescript
await client.setCoralOsConfig({
  url: 'http://localhost:8080',
  token: 'my-bearer-token',
})
```

---

### `listCoralSessions(namespace: string): Promise<unknown[]>`

Lists CoralOS sessions in a given namespace. Calls `GET /api/v1/coralos/sessions/:namespace`.

```typescript
const sessions = await client.listCoralSessions('default')
```

---

### `joinCoralMcpSession(params): Promise<boolean>`

Asks coral-server to join a CoralOS MCP session as a background agent. Calls `POST /api/v1/coralos/mcp/join`.

| Field | Type | Description |
|-------|------|-------------|
| `connection_url` | `string` | Full CoralOS MCP endpoint |
| `agent_name` | `string` | Name for the background agent |

```typescript
await client.joinCoralMcpSession({
  connection_url: 'http://localhost:8001/mcp',
  agent_name: 'rust-coral-agent',
})
```

---

### `getCoralMcpStatus(agentName: string): Promise<boolean>`

Returns `true` if an MCP session is currently active for the given agent name. Calls `GET /api/v1/coralos/mcp/status/:agentName`.

```typescript
const active = await client.getCoralMcpStatus('rust-coral-agent')
```

---

## Exported Types

All types are re-exported from `@pay/sdk`. They mirror the Rust structs and are compatible with `@pay/agent-core-ts` types (same field names, same shapes).

```typescript
import type {
  AgentState,
  AgentAction,
  AgentMeta,
  AgentMessage,
  SharedStateEntry,
  StateChange,
  WorkflowStep,
  Workflow,
  PaymentFlowRecord,
  CoralMention,
} from '@pay/sdk'
```

### `AgentAction`

```typescript
interface AgentAction {
  timestamp: string          // ISO 8601
  action_type: string        // e.g. 'poll-tick', 'payment-received', 'url-generated'
  details: string
  tx_signature: string | null
  slot: number | null
  latency_ms: number
}
```

### `AgentState`

```typescript
interface AgentState {
  is_running: boolean
  actions: AgentAction[]
  rpc_endpoint: string
  network: string            // 'devnet' | 'testnet' | 'mainnet-beta'
  strategy: string
}
```

### `AgentMeta`

```typescript
interface AgentMeta {
  role: string               // 'leader' | 'coordinator' | 'worker' | 'monitor' | 'analyst' | 'trader'
  created_at: string
  tags: string[]
}
```

### `AgentMessage`

```typescript
interface AgentMessage {
  id: string
  from: string
  to: string | null          // null = broadcast
  msg_type: string
  payload: string
  timestamp: string
}
```

### `SharedStateEntry`

```typescript
interface SharedStateEntry {
  value: unknown
  last_modified: string
  modified_by: string
  version: number
}
```

### `StateChange`

```typescript
interface StateChange {
  key: string
  old_value: unknown | null
  new_value: unknown
  timestamp: string
  changed_by: string
}
```

### `WorkflowStep`

```typescript
interface WorkflowStep {
  id: string
  name: string
  description: string
  status: string             // 'Pending' | 'Assigned' | 'InProgress' | 'Completed' | 'Failed'
  assigned_to: string | null
  dependencies: string[]     // step IDs
  result: string | null
  started_at: string | null
  completed_at: string | null
  timeout_secs: number | null
}
```

### `Workflow`

```typescript
interface Workflow {
  id: string
  name: string
  description: string
  status: string             // 'pending' | 'running' | 'completed' | 'failed'
  steps: WorkflowStep[]
  current_step: number
  created_at: string
  updated_at: string
  created_by: string
  assigned_agents: string[]
  priority: number
  tags: string[]
}
```

### `PaymentFlowRecord`

Complete audit trail of one payment lifecycle:

```typescript
interface PaymentFlowRecord {
  id: string
  agent_id: string
  endpoint: string
  status: string            // 'pending' | 'challenged' | 'paid' | 'delivered' | 'failed'
  protocol: string | null   // 'mpp' | 'x402'
  amount: number | null
  recipient: string | null
  token: string | null
  payment_header: string | null
  response_body: string | null
  error: string | null
  request_at: string        // ISO 8601 — initial request
  challenge_at: string | null   // when 402 was received
  payment_at: string | null     // when payment was submitted
  delivery_at: string | null    // when gated content was received
}
```

---

## Payment Flow Example

Full 10-step flow from agent creation to confirmed sale:

```typescript
import { CoralClient } from '@pay/sdk'

const client = new CoralClient('http://localhost:8080')

// 1. Create seller agent (Helius monitor watching for payment)
await client.createHeliusMonitorAgent({
  id: 'seller',
  recipient: 'SELLER_PUBKEY',
  amount_sol: 0.001,
  api_key: process.env.HELIUS_API_KEY!,
  label: 'DataFeed',
})

// 2. Create buyer agent (idle, will be manually triggered)
await client.createAgent('buyer')

// 3. Assign roles
await client.setAgentRole('seller', 'trader')
await client.setAgentRole('buyer', 'worker')

// 4. Start the seller — begins monitoring
await client.startAgent('seller')

// 5. Read the Solana Pay URL the seller generated
let payUrl = ''
for (let i = 0; i < 10; i++) {
  await new Promise(r => setTimeout(r, 500))
  const state = await client.getAgent('seller')
  const urlAction = state.actions.find(a => a.action_type === 'url-generated')
  if (urlAction) { payUrl = urlAction.details; break }
}
console.log('Payment URL:', payUrl)

// 6. Direct-message buyer with the URL
await client.sendMessage({
  from: 'system',
  to: 'buyer',
  msg_type: 'payment-request',
  payload: JSON.stringify({ url: payUrl }),
})

// 7. Write payment URL to shared state for visibility
await client.setState('current-payment-url', payUrl, 'seller')

// 8. Poll until seller detects payment
let txSig: string | null = null
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 2_000))
  const state = await client.getAgent('seller')
  const recv = state.actions.find(a => a.action_type === 'payment-received')
  if (recv) { txSig = recv.tx_signature; break }
}

// 9. Complete the sale — returns gated data
const data = await client.completeSale({
  seller_id: 'seller',
  buyer_id: 'buyer',
  tx_signature: txSig ?? undefined,
})
console.log('Gated data received:', data)

// 10. Inspect payment flows for audit trail
const flows = await client.getPaymentFlows()
console.log('Flow status:', flows.at(-1)?.status)
```
