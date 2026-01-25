/**
 * Exponential backoff with jitter.
 *
 * - attempt: 1..N
 * - baseMs: base delay (default 500ms)
 * - maxMs: max delay (default 30s)
 * - jitterRatio: 0..1 (default 0.2) => adds +/-20% randomness
 */
export function backoffMs(attempt, opts) {
  const a = Number(attempt)
  const baseMs = Number(opts?.baseMs ?? 500)
  const maxMs = Number(opts?.maxMs ?? 30_000)
  const jitterRatio = Number(opts?.jitterRatio ?? 0.2)

  const safeAttempt = Number.isFinite(a) && a > 0 ? Math.floor(a) : 1
  const safeBase = Number.isFinite(baseMs) && baseMs > 0 ? baseMs : 500
  const safeMax = Number.isFinite(maxMs) && maxMs > 0 ? maxMs : 30_000
  const safeJitter = Number.isFinite(jitterRatio) && jitterRatio >= 0 ? Math.min(1, jitterRatio) : 0.2

  const exp = safeBase * Math.pow(2, Math.min(20, safeAttempt - 1))
  const capped = Math.min(safeMax, exp)
  if (safeJitter === 0) return Math.round(capped)

  const delta = capped * safeJitter
  const r = (Math.random() * 2 - 1) * delta
  const v = capped + r
  return Math.max(0, Math.round(v))
}
