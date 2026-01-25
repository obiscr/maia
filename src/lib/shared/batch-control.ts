export type BatchStatusCounts = {
  queued: number
  paused: number
  running: number
}

export function batchControlAvailability(params: { canonicalStatus: string; statusCounts: BatchStatusCounts }): {
  canPause: boolean
  canResume: boolean
  canCancel: boolean
} {
  const canon = String(params.canonicalStatus || "").toUpperCase()
  const isTerminal = canon === "SUCCEEDED" || canon === "FAILED" || canon === "CANCELED"
  const counts = params.statusCounts
  const queued = Number(counts.queued) || 0
  const paused = Number(counts.paused) || 0
  const running = Number(counts.running) || 0

  const canPause = !isTerminal && queued > 0
  const canResume = paused > 0
  const canCancel = !isTerminal && queued + paused + running > 0
  return { canPause, canResume, canCancel }
}
