function canonicalizeRunStatus(raw: string | null | undefined): string {
  const up = String(raw ?? "").toUpperCase()
  if (up === "CANCELLED") return "CANCELED"
  return up
}

export function toUiJobStatus(params: {
  canonicalJobStatus: string
  jobCancelRequestedAtIso?: string | null
  runCancelRequestedAtIso?: string | null
}): string {
  const canon = String(params.canonicalJobStatus || "").toUpperCase()
  const hasCancelRequested =
    !!(typeof params.jobCancelRequestedAtIso === "string" && params.jobCancelRequestedAtIso.trim()) ||
    !!(typeof params.runCancelRequestedAtIso === "string" && params.runCancelRequestedAtIso.trim())
  if (!hasCancelRequested) return canon
  // UI-only status: cancel is requested but the job is not terminal yet.
  if (canon === "QUEUED" || canon === "PAUSED" || canon === "RUNNING") return "CANCELING"
  return canon
}

export function jobControlAvailability(params: {
  /** Canonical job status, e.g. RUNNING/QUEUED/SUCCEEDED/FAILED/CANCELED */
  canonicalJobStatus: string
  jobCancelRequestedAtIso?: string | null
  runCancelRequestedAtIso?: string | null
  /** Optional: when job is linked to a run, match detail: only allow cancel when run is RUNNING/PENDING_INPUTS */
  runStatus?: string | null
}): {
  uiStatus: string
  canCancel: boolean
  canResume: boolean
} {
  const canon = String(params.canonicalJobStatus || "").toUpperCase()
  const runCanon = canonicalizeRunStatus(params.runStatus)
  const uiStatus = toUiJobStatus({
    canonicalJobStatus: canon,
    jobCancelRequestedAtIso: params.jobCancelRequestedAtIso,
    runCancelRequestedAtIso: params.runCancelRequestedAtIso,
  })

  const hasCancelRequested =
    uiStatus === "CANCELING" ||
    !!(typeof params.jobCancelRequestedAtIso === "string" && params.jobCancelRequestedAtIso.trim()) ||
    !!(typeof params.runCancelRequestedAtIso === "string" && params.runCancelRequestedAtIso.trim())

  const isTerminal = canon === "SUCCEEDED" || canon === "FAILED" || canon === "CANCELED"
  const isActiveJob = canon === "QUEUED" || canon === "PAUSED" || canon === "RUNNING"

  // Match detail semantics:
  // - If cancel already requested at job OR run level, do not allow cancel again.
  // - If a run exists, only allow cancel when run is cancelable (RUNNING/PENDING_INPUTS).
  const runAllowsCancel = !runCanon ? true : runCanon === "RUNNING" || runCanon === "PENDING_INPUTS"
  const canCancel = !hasCancelRequested && !isTerminal && isActiveJob && runAllowsCancel

  // Resume is only meaningful for paused jobs; if cancel requested, do not allow resume.
  const canResume = canon === "PAUSED" && !hasCancelRequested

  return { uiStatus, canCancel, canResume }
}

