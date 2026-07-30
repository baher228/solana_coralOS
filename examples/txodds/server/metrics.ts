/**
 * Tiny Prometheus-style metrics registry (no dependency). Exposed at GET /metrics.
 * Scrape it from an internal network / firewall it off from the public internet.
 */
import { jobs } from './store.js'

const counters = new Map<string, number>()

export function incr(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by)
}

export function resetMetricsForTest(): void {
  counters.clear()
}

/** Gauges are computed at scrape time from live state. */
function gauges(): Array<{ name: string; help: string; value: number }> {
  const all = [...jobs.values()]
  return [
    { name: 'txodds_jobs_total', help: 'Total jobs in the store', value: all.length },
    {
      name: 'txodds_settlement_errors',
      help: 'Jobs with a recorded settlement error (stuck escrow signal)',
      value: all.filter((j) => j.settlement.settlementError).length,
    },
    {
      name: 'txodds_devnet_escrows_active',
      help: 'Non-terminal devnet escrows',
      value: all.filter((j) => j.settlement.mode === 'devnet-escrow' && !['released', 'refunded', 'cancelled'].includes(j.status)).length,
    },
  ]
}

export function renderMetrics(): string {
  const lines: string[] = []
  for (const [name, value] of counters) {
    lines.push(`# TYPE ${name} counter`)
    lines.push(`${name} ${value}`)
  }
  for (const g of gauges()) {
    lines.push(`# HELP ${g.name} ${g.help}`)
    lines.push(`# TYPE ${g.name} gauge`)
    lines.push(`${g.name} ${g.value}`)
  }
  return lines.join('\n') + '\n'
}
