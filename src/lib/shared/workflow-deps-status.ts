import type { ComponentType } from "react"
import { CheckCircle2, Clock, ListChecks, TriangleAlertIcon, XCircle } from "lucide-react"

import { Spinner } from "@/components/ui/spinner"

export function toCanonicalWorkflowDepsStatus(s: string) {
  return String(s || "").toUpperCase()
}

export function toUiWorkflowDepsStatus(
  status: string,
  opts?: {
    /**
     * UI-only: if false, treat as not configured even if server status is READY.
     * This is used by the settings card (0 deps) and is intentionally NOT stored in DB.
     */
    configured?: boolean
    /**
     * UI-only: dirty deps always require install, even if server still says READY.
     * This mirrors the existing deps sheet behavior.
     */
    dirty?: boolean
  },
) {
  const s = toCanonicalWorkflowDepsStatus(status)
  if (opts?.dirty) return "IDLE"
  if (opts?.configured === false) return "NOT_CONFIGURED"
  if (s === "READY" || s === "INSTALLING" || s === "FAILED" || s === "IDLE") return s
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

export type WorkflowDepsStatusUiSpec = StatusUiVarsSpec & StatusUiIconSpec

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

function workflowDepsStatusVarsClassName(status: string) {
  const s = toCanonicalWorkflowDepsStatus(status)
  if (s === "NOT_CONFIGURED") return "maia-status-badge--neutral"
  if (s === "FAILED") return "maia-status-badge--failed"
  if (s === "READY") return "maia-status-badge--succeeded"
  if (s === "INSTALLING") return "maia-status-badge--running"
  if (s === "IDLE") return "maia-status-badge--needs-action"
  return "maia-status-badge--unknown"
}

function workflowDepsStatusIcon(status: string): { Icon: IconType | null; className?: string } {
  const s = toCanonicalWorkflowDepsStatus(status)
  if (s === "INSTALLING") return { Icon: Spinner }
  if (s === "READY") return { Icon: CheckCircle2 }
  if (s === "FAILED") return { Icon: XCircle }
  if (s === "IDLE") return { Icon: Clock }
  if (s === "NOT_CONFIGURED") return { Icon: TriangleAlertIcon }
  return { Icon: ListChecks }
}

/**
 * Single entrypoint for Workflow deps status UI styling (icon + CSS vars + convenience classes).
 *
 * Design:
 * - The DB status is stable (Prisma enum spelling).
 * - Callers should prefer consuming this spec over composing icon/color/badge logic manually.
 */
export function workflowDepsStatusUiSpec(status: string): WorkflowDepsStatusUiSpec {
  const s = toCanonicalWorkflowDepsStatus(status)
  const vars = workflowDepsStatusVarsClassName(s)
  const icon = workflowDepsStatusIcon(s)
  return {
    ...baseVarsSpec(s, vars),
    Icon: icon.Icon ?? null,
    iconClassName: icon.className,
  }
}
