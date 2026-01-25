export type RunStepErrorCode =
  | "STEP_TIMEOUT"
  | "STEP_SIGNAL"
  | "STEP_EXIT_CODE"
  | "RUNNER_EXEC_FAILED"
  | "OUTPUT_MISSING"
  | "OUTPUT_INVALID"
  | "UNKNOWN"

export type RunStepErrorMeta = {
  timeoutMs?: number | null
  signal?: string | null
  exitCode?: number | null
  outputParseError?: string | null
  detail?: string | null
}

export function formatRunStepErrorDetails(meta: RunStepErrorMeta | null | undefined) {
  if (!meta || typeof meta !== "object") return ""
  const parts: string[] = []
  if (meta.timeoutMs != null) parts.push(`timeoutMs=${meta.timeoutMs}`)
  if (meta.signal != null) parts.push(`signal=${meta.signal}`)
  if (meta.exitCode != null) parts.push(`exitCode=${meta.exitCode}`)
  if (meta.outputParseError) parts.push(`outputParseError=${JSON.stringify(String(meta.outputParseError))}`)
  if (meta.detail) parts.push(`detail=${JSON.stringify(String(meta.detail))}`)
  return parts.join(" ")
}
