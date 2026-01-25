export const RUN_FORCE_STOP_MIN_CANCELING_AGE_MS = 15_000

export function calcCancelRequestedAgeMs(cancelRequestedAtIso: string | null | undefined, nowMs = Date.now()): number {
  const raw = typeof cancelRequestedAtIso === "string" ? cancelRequestedAtIso : ""
  if (!raw.trim()) return 0
  const ts = new Date(raw).getTime()
  if (!Number.isFinite(ts)) return 0
  return Math.max(0, nowMs - ts)
}

export function runControlAvailability(params: {
  canonicalStatus: string
  cancelRequestedAtIso?: string | null
  nowMs?: number
}): {
  isCanceling: boolean
  canCancel: boolean
  showForceStop: boolean
} {
  const canon = String(params.canonicalStatus || "").toUpperCase()
  const isCanceling = canon === "CANCELING"
  const isTerminal = canon === "SUCCEEDED" || canon === "FAILED" || canon === "CANCELED"
  const canCancel = !isCanceling && !isTerminal && (canon === "RUNNING" || canon === "PENDING_INPUTS")
  const age = calcCancelRequestedAgeMs(params.cancelRequestedAtIso ?? null, params.nowMs)
  const showForceStop = isCanceling && age > RUN_FORCE_STOP_MIN_CANCELING_AGE_MS
  return { isCanceling, canCancel, showForceStop }
}
