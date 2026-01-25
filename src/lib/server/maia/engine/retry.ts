import "server-only"

export function computeRetryBackoffMs(attemptCount: number) {
  // attemptCount is 1-based (we increment when claiming).
  // Exponential backoff (roughly: 5s, 15s, 45s, 2m+, ...), capped at 5m, with small jitter.
  const baseMs = 5_000
  const maxMs = 5 * 60_000
  const exp = Math.max(0, attemptCount - 1)
  const raw = baseMs * Math.pow(3, exp)
  const capped = Math.min(maxMs, raw)

  // Jitter: +/- 15% to avoid thundering herd (bounded + deterministic enough).
  const jitterPct = 0.15
  const r = Math.random() * 2 - 1 // [-1, 1)
  const jittered = capped * (1 + r * jitterPct)
  return Math.max(0, Math.round(jittered))
}
