/**
 * Strategy registry — maps strategy name strings to factory functions.
 *
 * To add a custom strategy:
 * 1. Add an entry to `REGISTRY` below.
 * 2. Create an agent via HTTP:
 *    `POST /api/v1/agents   body: { "id": "my-agent", "strategy": "my-strategy" }`
 * 3. The agent immediately accepts:
 *    `POST /api/v1/agents/:id/handle  body: { "text": "..." }`
 *
 * Solana-dependent strategies (transfer, helius-monitor) are commented out because
 * they require `@solana/web3.js` and `@solana/pay` — uncomment after `npm install`
 * in `packages/agent-runtime/`.
 */

import { AgentManager } from '../../packages/agent-runtime/src/manager.js'
import type { Strategy } from '../../packages/agent-runtime/src/strategy.js'
import { IdleStrategy } from '../../packages/agent-runtime/src/strategies/idle.js'
import { RpcPollStrategy } from '../../packages/agent-runtime/src/strategies/rpc_poll.js'
import { WeatherStrategy } from '../../packages/agent-runtime/src/strategies/weather.js'

// import { TransferStrategy } from '../../packages/agent-runtime/src/strategies/transfer.js'
// import { HeliusMonitorStrategy } from '../../packages/agent-runtime/src/strategies/helius_monitor.js'

/** Factory function type — accepts an optional JSON config object, returns a `Strategy`. */
type Factory = (config?: unknown) => Strategy

/**
 * Registry of all available strategies.
 * Key: the `strategy` field sent in `POST /api/v1/agents`.
 * Value: factory that instantiates the strategy from an optional config object.
 */
export const REGISTRY: Record<string, Factory> = {
  'idle':     ()           => new IdleStrategy(),
  'rpc-poll': (c: unknown) => new RpcPollStrategy((c as { intervalMs?: number } | undefined)?.intervalMs),
  'weather':  ()           => new WeatherStrategy(),
  // 'transfer':       (c) => new TransferStrategy(c as TransferConfig),
  // 'helius-monitor': (c) => new HeliusMonitorStrategy(c as HeliusMonitorConfig),
}

/**
 * Instantiate a strategy by name. Throws if the name is not in `REGISTRY`.
 * Called by `POST /api/v1/agents` to resolve the `strategy` body field.
 */
export function makeStrategy(name: string, config?: unknown): Strategy {
  const factory = REGISTRY[name]
  if (!factory) throw new Error(`unknown strategy: "${name}" — registered: ${Object.keys(REGISTRY).join(', ')}`)
  return factory(config)
}

// ── Singleton manager ──────────────────────────────────────────────────────
// One AgentManager per process. All route handlers share it.

export const manager = new AgentManager()

// Pre-register the weather agent so the web marketplace works without any
// manual setup step. Hackathon students can add more via POST /api/v1/agents.
manager.createAgent('weather-agent', new WeatherStrategy())
