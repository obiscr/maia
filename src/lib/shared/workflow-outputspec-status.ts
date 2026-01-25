import type { ComponentType } from "react"
import { CheckCircle2, TriangleAlertIcon, XCircle } from "lucide-react"

export function toCanonicalWorkflowOutputsSpecStatus(s: string) {
  return String(s || "").toUpperCase()
}

export type WorkflowOutputsSpecUiStatus = "NOT_CONFIGURED" | "VALID" | "INVALID" | "DIRTY"

/**
 * UI-only status derivation for Outputs Spec.
 *
 * Precedence is intentional:
 * - INVALID blocks save and should be shown even if dirty.
 * - DIRTY means there are unsaved changes (when JSON/spec is valid).
 * - NOT_CONFIGURED means empty spec (recommended configuration).
 * - VALID means configured and JSON/spec is valid.
 */
export function toUiWorkflowOutputsSpecStatus(opts: {
  configured?: boolean
  dirty?: boolean
  invalid?: boolean
}): WorkflowOutputsSpecUiStatus {
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

export type WorkflowOutputsSpecStatusUiSpec = StatusUiVarsSpec & StatusUiIconSpec

function baseVarsSpec(status: string, varsClassName: string): StatusUiVarsSpec {
  return {
    status,
    varsClassName,
    textClassName: "text-[color:var(--maia-status-text)]",
    containerClassName: "bg-[var(--maia-status-bg)] border-[var(--maia-status-border)]",
    borderClassName: "border-[var(--maia-status-border)]",
  }
}

function workflowOutputsSpecStatusVarsClassName(status: string) {
  const s = toCanonicalWorkflowOutputsSpecStatus(status)
  // IMPORTANT: outputs spec is recommended, so NOT_CONFIGURED uses warning color (needs-action).
  if (s === "NOT_CONFIGURED") return "maia-status-badge--needs-action"
  if (s === "INVALID") return "maia-status-badge--failed"
  if (s === "VALID") return "maia-status-badge--succeeded"
  if (s === "DIRTY") return "maia-status-badge--needs-action"
  return "maia-status-badge--unknown"
}

function workflowOutputsSpecStatusIcon(status: string): { Icon: IconType | null; className?: string } {
  const s = toCanonicalWorkflowOutputsSpecStatus(status)
  if (s === "VALID") return { Icon: CheckCircle2 }
  if (s === "INVALID") return { Icon: XCircle }
  if (s === "DIRTY") return { Icon: TriangleAlertIcon }
  if (s === "NOT_CONFIGURED") return { Icon: TriangleAlertIcon }
  return { Icon: TriangleAlertIcon }
}

export function workflowOutputsSpecStatusUiSpec(status: string): WorkflowOutputsSpecStatusUiSpec {
  const s = toCanonicalWorkflowOutputsSpecStatus(status)
  const vars = workflowOutputsSpecStatusVarsClassName(s)
  const icon = workflowOutputsSpecStatusIcon(s)
  return {
    ...baseVarsSpec(s, vars),
    Icon: icon.Icon ?? null,
    iconClassName: icon.className,
  }
}
