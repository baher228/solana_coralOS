/**
 * Minimal structured (JSON-lines) logger. Dependency-free so it stays robust in
 * the deploy path; swap for pino/winston if richer transport is needed. Each
 * record is one JSON object: { time, level, msg, ...fields }.
 */
type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function threshold(): number {
  const configured = (process.env.LOG_LEVEL || 'info').toLowerCase() as Level
  return LEVELS[configured] ?? LEVELS.info
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold()) return
  const record = { time: new Date().toISOString(), level, msg, ...fields }
  const line = JSON.stringify(record, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v))
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
}
