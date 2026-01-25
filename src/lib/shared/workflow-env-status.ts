import type { ComponentType } from "react"
import { CheckCircle2, TriangleAlertIcon, XCircle } from "lucide-react"

export function toCanonicalWorkflowEnvStatus(s: string) {
  return String(s || "").toUpperCase()
}

export type WorkflowEnvUiStatus = "NOT_CONFIGURED" | "READY" | "DIRTY" | "FAILED"

export function toUiWorkflowEnvStatus(opts: {
  configured?: boolean
  dirty?: boolean
  error?: boolean
}): WorkflowEnvUiStatus {
  if (opts.error) return "FAILED"
  if (opts.dirty) return "DIRTY"
  if (opts.configured === false) return "NOT_CONFIGURED"
  return "READY"
}

type IconType = ComponentType<{ className?: string }>

export type StatusUiVarsSpec = {
  /** Canonicalized status string (uppercase). */
  status: string
  /** A `maia-status-badge--*` class that defines `--maia-status-*` variables. */
  varsClassName: string
  /** Convenience: use the shared status palette variables for text/icon color. */
  textClassName: string
  /** Convenience: use the shared status palette variables for container styling. */
  containerClassName: string
  /** Convenience: standard border class that matches the container. */
  borderClassName: string
}

export type StatusUiIconSpec = {
  Icon: IconType | null
  iconClassName?: string
}

export type WorkflowEnvStatusUiSpec = StatusUiVarsSpec & StatusUiIconSpec

function baseVarsSpec(status: string, varsClassName: string): StatusUiVarsSpec {
  return {
    status,
    varsClassName,
    // NOTE: `--maia-status-text` is defined by `maia-status-badge--*` classes in `src/styles/maia/status-badges.css`.
    textClassName: "text-[color:var(--maia-status-text)]",
    containerClassName: "bg-[var(--maia-status-bg)] border-[var(--maia-status-border)]",
    borderClassName: "border-[var(--maia-status-border)]",
  }
}

function workflowEnvStatusVarsClassName(status: string) {
  const s = toCanonicalWorkflowEnvStatus(status)
  if (s === "NOT_CONFIGURED") return "maia-status-badge--neutral"
  if (s === "FAILED") return "maia-status-badge--failed"
  if (s === "READY") return "maia-status-badge--succeeded"
  if (s === "DIRTY") return "maia-status-badge--needs-action"
  return "maia-status-badge--unknown"
}

function workflowEnvStatusIcon(status: string): { Icon: IconType | null; className?: string } {
  const s = toCanonicalWorkflowEnvStatus(status)
  if (s === "READY") return { Icon: CheckCircle2 }
  if (s === "FAILED") return { Icon: XCircle }
  if (s === "DIRTY") return { Icon: TriangleAlertIcon }
  if (s === "NOT_CONFIGURED") return { Icon: TriangleAlertIcon }
  return { Icon: TriangleAlertIcon }
}

/**
 * Single entrypoint for Workflow env status UI styling (icon + CSS vars + convenience classes).
 *
 * Design:
 * - Env has no DB-backed status; this is UI-only and derived from {configured, dirty, error}.
 * - Callers should prefer consuming this spec over composing icon/color/badge logic manually.
 */
export function workflowEnvStatusUiSpec(status: string): WorkflowEnvStatusUiSpec {
  const s = toCanonicalWorkflowEnvStatus(status)
  const vars = workflowEnvStatusVarsClassName(s)
  const icon = workflowEnvStatusIcon(s)
  return {
    ...baseVarsSpec(s, vars),
    Icon: icon.Icon ?? null,
    iconClassName: icon.className,
  }
}
