export type ErrorLayer =
  | "step"
  | "attempt"
  | "run"
  | "job"
  | "workflow"
  | "schedule"
  | "batch"
  | "operation"
  | "api"
  | "system"

export type ErrorEnvelope = {
  /**
   * Stable, machine-friendly identifier used for grouping/searching.
   * Examples: STEP_TIMEOUT, RUN_STEP_FAILED, NPM_INSTALL_FAILED
   */
  code: string

  /**
   * Raw / technical message (optional). Not i18n.
   */
  message?: string | null

  /**
   * Optional classification for debugging/UX (not required to render).
   */
  layer?: ErrorLayer | null

  /**
   * Optional structured data (e.g. timeoutMs, exitCode, stepKey).
   */
  meta?: Record<string, unknown> | null

  /**
   * Wrapper → root-cause chain.
   * If present, the last cause is typically the most specific root cause.
   */
  causes?: ErrorEnvelope[] | null
}

export type DisplayError = {
  /**
   * What we show as the primary badge/code (root cause preferred).
   */
  display: ErrorEnvelope

  /**
   * The top-level wrapper error (the one attached to the entity).
   */
  wrapper: ErrorEnvelope

  /**
   * Full chain including wrapper and causes, in order (wrapper → ... → root).
   */
  chain: ErrorEnvelope[]
}
