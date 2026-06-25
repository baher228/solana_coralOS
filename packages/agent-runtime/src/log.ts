/**
 * Tiny structured-logging helper shared by agents and the smoke harness.
 *
 * Default: human-readable `[agent] event — data` on stderr (good in Docker logs).
 * Set `AGENT_JSON_LOGS=1` to emit one JSON object per line instead, so dashboards and the
 * smoke scripts can parse a single stream rather than scraping prose.
 *
 * stderr is used (not stdout) so agents that stream JSON *results* on stdout stay uncontaminated.
 */
const JSON_MODE = process.env.AGENT_JSON_LOGS === '1' || process.env.AGENT_JSON_LOGS === 'true'

/**
 * Emit one log line.
 * @param agent - Source agent name, e.g. `"echo-agent"`.
 * @param event - Short event key, e.g. `"connected"`, `"payment-sent"`.
 * @param data  - Optional structured payload.
 */
export function log(agent: string, event: string, data?: unknown): void {
  if (JSON_MODE) {
    process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), agent, event, data }) + '\n')
  } else {
    const suffix = data === undefined ? '' : ` — ${typeof data === 'string' ? data : JSON.stringify(data)}`
    process.stderr.write(`[${agent}] ${event}${suffix}\n`)
  }
}
