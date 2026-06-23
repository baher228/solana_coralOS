// CoralServerSync — optional bridge so TypeScript agents appear in the coral-server UI
// and can exchange messages with Rust agents.

import type { AgentManager } from './manager.js'

export class CoralServerSync {
  private url = ''
  private pollInterval: ReturnType<typeof setInterval> | null = null

  async attach(manager: AgentManager, coralUrl: string): Promise<void> {
    this.url = coralUrl.replace(/\/$/, '')

    // Register each local agent with coral-server
    for (const [id] of manager.listAgents()) {
      try {
        await fetch(`${this.url}/api/v1/agents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        })
      } catch { /* server may not be up yet */ }
    }

    // Poll for inbound messages and push state
    this.pollInterval = setInterval(async () => {
      for (const [id] of manager.listAgents()) {
        try {
          // Push local agent state (via actions — just heartbeat for now)
          const msgs = await fetch(`${this.url}/api/v1/messages/${id}`).then(r => r.json())
          for (const msg of msgs) {
            manager.bus.send(msg)
          }
        } catch { /* silently skip */ }
      }
    }, 2000)
  }

  detach(): void {
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null }
  }
}
