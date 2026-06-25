/**
 * Express application for the agent-economy API server.
 *
 * Routes are grouped by resource. All routes live under `/api/v1/` except `/health`.
 * The singleton `AgentManager` (and its shared `MessageBus`, `SharedState`, and
 * `WorkflowEngine`) is imported from `registry.ts`.
 */
import express from 'express'
import cors from 'cors'
import { manager, makeStrategy } from './registry.js'
import { WeatherStrategy } from '../../packages/agent-runtime/src/strategies/weather.js'

const app = express()
app.use(cors())
app.use(express.json())

// ── Health ──────────────────────────────────────────────────────────────────

/** `GET /health` — liveness probe used by Docker and CI. */
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', runtime: 'node', version: '0.1.0' })
})

// ── Agents ──────────────────────────────────────────────────────────────────

/** `GET /api/v1/agents` — list all agents as `[id, AgentState]` pairs. */
app.get('/api/v1/agents', (_req, res) => {
  res.json(manager.listAgents())
})

/**
 * `POST /api/v1/agents` — create a new agent.
 * Body: `{ id: string, strategy?: string, config?: unknown }`
 * Returns `201 AgentState` or `409` if the id is already taken.
 */
app.post('/api/v1/agents', (req, res) => {
  const { id, strategy = 'idle', config } = req.body as { id: string; strategy?: string; config?: unknown }
  if (!id) { res.status(400).json({ error: 'id is required' }); return }
  try {
    const s = makeStrategy(strategy, config)
    const state = manager.createAgent(id, s)
    if (!state) { res.status(409).json({ error: 'agent already exists' }); return }
    res.status(201).json(state)
  } catch (e) {
    res.status(400).json({ error: String(e) })
  }
})

/** `GET /api/v1/agents/:id` — return a single agent's `AgentState`. */
app.get('/api/v1/agents/:id', (req, res) => {
  const state = manager.getAgentState(req.params.id)
  if (!state) { res.status(404).json({ error: 'not found' }); return }
  res.json(state)
})

/** `DELETE /api/v1/agents/:id` — stop and remove an agent. Returns `true`. */
app.delete('/api/v1/agents/:id', (req, res) => {
  res.json(manager.removeAgent(req.params.id))
})

/** `POST /api/v1/agents/:id/start` — start the agent's strategy loop. */
app.post('/api/v1/agents/:id/start', async (req, res) => {
  const ok = await manager.startAgent(req.params.id)
  if (!ok) { res.status(404).json({ error: 'not found or already running' }); return }
  res.json(ok)
})

/** `POST /api/v1/agents/:id/stop` — abort the agent's strategy loop. */
app.post('/api/v1/agents/:id/stop', (req, res) => {
  res.json(manager.stopAgent(req.params.id))
})

/**
 * `POST /api/v1/agents/:id/handle` — dispatch a message to an agent's strategy.
 * Body: `{ text: string }`
 * Returns `{ reply: string }`.
 *
 * TypeScript equivalent of the CoralOS MCP `wait_for_mention → send_message` loop.
 */
app.post('/api/v1/agents/:id/handle', async (req, res) => {
  const { text } = req.body as { text: string }
  if (typeof text !== 'string') { res.status(400).json({ error: 'text is required' }); return }
  const reply = await manager.handleMessage(req.params.id, text)
  if (reply === null) { res.status(404).json({ error: 'agent not found' }); return }
  res.json({ reply })
})

// ── Shared State ────────────────────────────────────────────────────────────

/** `GET /api/v1/shared-state` — return all entries as `Record<string, SharedStateEntry>`. */
app.get('/api/v1/shared-state', (_req, res) => {
  res.json(manager.state.getAll())
})

/**
 * `POST /api/v1/shared-state/:key` — create or update a key.
 * Body: `{ value: unknown, changed_by?: string }`
 */
app.post('/api/v1/shared-state/:key', (req, res) => {
  const { value, changed_by = 'api' } = req.body as { value: unknown; changed_by?: string }
  manager.state.set(req.params.key, value, changed_by)
  res.json(true)
})

/** `DELETE /api/v1/shared-state/:key` — delete a key from shared state. */
app.delete('/api/v1/shared-state/:key', (req, res) => {
  manager.state.delete(req.params.key, 'api')
  res.json(true)
})

// ── Messages ────────────────────────────────────────────────────────────────

/** `GET /api/v1/messages` — return all messages in the bus buffer. */
app.get('/api/v1/messages', (_req, res) => {
  res.json(manager.bus.getAll())
})

/**
 * `POST /api/v1/messages` — enqueue a broadcast or direct message.
 * Body: `{ from: string, to?: string, msg_type: string, payload: string }`
 * Omit `to` for a broadcast (visible to all agents).
 */
app.post('/api/v1/messages', (req, res) => {
  const { from, to, msg_type, payload } = req.body as {
    from: string; to?: string; msg_type: string; payload: string
  }
  if (to) {
    manager.direct(from, to, msg_type, payload)
  } else {
    manager.broadcast(from, msg_type, payload)
  }
  res.json(true)
})

// ── Weather ─────────────────────────────────────────────────────────────────

/**
 * `POST /api/v1/weather` — fetch live weather via Open-Meteo (no API key needed).
 * Body: `{ city: string }` **or** `{ lat: number, lon: number }`
 *
 * Called by the web result page after the Phantom wallet payment is confirmed.
 * Runs `WeatherStrategy.handleMessage()` directly — no persistent agent required.
 */
app.post('/api/v1/weather', async (req, res) => {
  const { city, lat, lon } = req.body as { city?: string; lat?: number; lon?: number }
  if (!city && (lat === undefined || lon === undefined)) {
    res.status(400).json({ error: 'provide city or lat+lon' })
    return
  }

  const text = city
    ? JSON.stringify({ city })
    : JSON.stringify({ lat, lon })

  const strategy = new WeatherStrategy()
  const start = Date.now()

  // Minimal MutableAgentState for a one-shot call without a running agent.
  const mockState = {
    id: 'weather-agent',
    rpcEndpoint: 'https://api.devnet.solana.com',
    network: 'devnet',
    recordAction: (type: string, details: string) => {
      // Mirror action to the persistent weather-agent if it is registered.
      manager.getAgent('weather-agent')?.recordAction(type, details)
    },
    snapshot: () => manager.getAgentState('weather-agent')!,
  }

  try {
    const resultStr = await strategy.handleMessage(text, mockState)
    const data = JSON.parse(resultStr) as unknown
    const latency_ms = Date.now() - start
    res.json({ ok: true, data, latency_ms })
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) })
  }
})

export default app
