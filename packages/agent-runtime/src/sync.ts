import type { AgentManager } from './manager.js'

/**
 * Optional bridge that makes TypeScript agents visible in a running `api-server` server
 * (or any compatible coral-server) and mirrors inbound messages to the local bus.
 *
 * Call `attach()` once after the server is up. It registers every local agent via
 * `POST /api/v1/agents`, then polls `GET /api/v1/messages/:id` every 2 seconds and
 * forwards new messages to the local `MessageBus`.
 *
 * Call `detach()` to stop polling (e.g. on process exit).
 */
export class CoralServerSync {
  private url = ''
  private pollInterval: ReturnType<typeof setInterval> | null = null

  /**
   * Register all agents in `manager` with the remote server and start the sync poll.
   *
   * @param manager   - The local `AgentManager` whose agents and bus to sync.
   * @param coralUrl  - Base URL of the coral-server (e.g. `"http://localhost:8081"`).
   *                    A trailing slash is stripped automatically.
   */
  async attach(manager: AgentManager, coralUrl: string): Promise<void> {
    this.url = coralUrl.replace(/\/$/, '')

    for (const [id] of manager.listAgents()) {
      try {
        await fetch(`${this.url}/api/v1/agents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        })
      } catch { /* server may not be up yet — silently skip */ }
    }

    this.pollInterval = setInterval(async () => {
      for (const [id] of manager.listAgents()) {
        try {
          const msgs = await fetch(`${this.url}/api/v1/messages/${id}`).then(r => r.json()) as import('./types.js').AgentMessage[]
          for (const msg of msgs) {
            manager.bus.send(msg)
          }
        } catch { /* silently skip on transient network error */ }
      }
    }, 2000)
  }

  /** Stop the sync poll. Safe to call even if `attach()` was never called. */
  detach(): void {
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null }
  }
}
