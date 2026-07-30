import type http from 'node:http'

// Lightweight fixed-window, per-client rate limiter. Enough to blunt brute-force
// and accidental floods on a single-instance deployment; front it with a real
// gateway/WAF for higher scale. Disabled when RATE_LIMIT_MAX <= 0.
interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

function limitConfig(): { max: number; windowMs: number } {
  const max = Number(process.env.RATE_LIMIT_MAX ?? 600)
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000)
  return {
    max: Number.isFinite(max) ? max : 600,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000,
  }
}

function clientKey(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded
  const ip = header?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'
  return ip
}

export function rateLimited(req: http.IncomingMessage, now = Date.now()): { limited: boolean; retryAfterMs: number } {
  const { max, windowMs } = limitConfig()
  if (max <= 0) return { limited: false, retryAfterMs: 0 }
  const key = clientKey(req)
  const bucket = buckets.get(key)
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { limited: false, retryAfterMs: 0 }
  }
  bucket.count += 1
  if (bucket.count > max) return { limited: true, retryAfterMs: Math.max(0, bucket.resetAt - now) }
  return { limited: false, retryAfterMs: 0 }
}

export function resetRateLimitForTest(): void {
  buckets.clear()
}
