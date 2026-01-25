import type { ComponentType } from "react"
import { CheckCircle2, TriangleAlertIcon, XCircle } from "lucide-react"

export function toCanonicalWorkflowInputSpecStatus(s: string) {
  return String(s || "").toUpperCase()
}

export type WorkflowInputSpecUiStatus = "NOT_CONFIGURED" | "VALID" | "INVALID" | "DIRTY"

/**
 * UI-only status derivation for Input Spec.
 *
 * Precedence is intentional:
 * - INVALID blocks save and should be shown even if dirty.
 * - DIRTY means there are unsaved changes (when JSON is valid).
 * - NOT_CONFIGURED means empty spec (no saved config).
 * - VALID means configured and JSON is valid.
 */
export function toUiWorkflowInputSpecStatus(opts: {
  configured?: boolean
  dirty?: boolean
  invalid?: boolean
}): WorkflowInputSpecUiStatus {
  if (opts.invalid) return "INVALID"
  if (opts.dirty) return "DIRTY"
  if (opts.configured === false) return "NOT_CONFIGURED"
  return "VALID"
}

type IconType = ComponentType<{ className?: string }>

export type StatusUiVarsSpec = {
  status: string
  varsClassName: string
  textClassName: string
  containerClassName: string
  borderClassName: string
}

export type StatusUiIconSpec = {
  Icon: IconType | null
  iconClassName?: string
}

export type WorkflowInputSpecStatusUiSpec = StatusUiVarsSpec & StatusUiIconSpec

function baseVarsSpec(status: string, varsClassName: string): StatusUiVarsSpec {
  return {
    status,
    varsClassName,
    textClassName: "text-[color:var(--maia-status-text)]",
    containerClassName: "bg-[var(--maia-status-bg)] border-[var(--maia-status-border)]",
    borderClassName: "border-[var(--maia-status-border)]",
  }
}

function workflowInputSpecStatusVarsClassName(status: string) {
  const s = toCanonicalWorkflowInputSpecStatus(status)
  if (s === "NOT_CONFIGURED") return "maia-status-badge--neutral"
  if (s === "INVALID") return "maia-status-badge--failed"
  if (s === "VALID") return "maia-status-badge--succeeded"
  if (s === "DIRTY") return "maia-status-badge--needs-action"
  return "maia-status-badge--unknown"
}

function workflowInputSpecStatusIcon(status: string): { Icon: IconType | null; className?: string } {
  const s = toCanonicalWorkflowInputSpecStatus(status)
  if (s === "VALID") return { Icon: CheckCircle2 }
  if (s === "INVALID") return { Icon: XCircle }
  if (s === "DIRTY") return { Icon: TriangleAlertIcon }
  if (s === "NOT_CONFIGURED") return { Icon: TriangleAlertIcon }
  return { Icon: TriangleAlertIcon }
}

export function workflowInputSpecStatusUiSpec(status: string): WorkflowInputSpecStatusUiSpec {
  const s = toCanonicalWorkflowInputSpecStatus(status)
  const vars = workflowInputSpecStatusVarsClassName(s)
  const icon = workflowInputSpecStatusIcon(s)
  return {
    ...baseVarsSpec(s, vars),
    Icon: icon.Icon ?? null,
    iconClassName: icon.className,
  }
}
