import type { ComponentType } from "react"
import { CheckCircle2, Clock, XCircle } from "lucide-react"

import { Spinner } from "@/components/ui/spinner"

export function toCanonicalOperationStatus(s: string) {
  return (s || "").toUpperCase()
}

type IconType = ComponentType<{ className?: string }>

export type StatusUiVarsSpec = {
  /**
   * Canonicalized status string (uppercase).
   * Operation currently has no UI-only statuses.
   */
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

export type OperationStatusUiSpec = StatusUiVarsSpec & StatusUiIconSpec

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

function operationStatusVarsClassName(status: string) {
  const s = toCanonicalOperationStatus(status)
  if (s === "FAILED") return "maia-status-badge--failed"
  if (s === "SUCCEEDED") return "maia-status-badge--succeeded"
  if (s === "RUNNING") return "maia-status-badge--running"
  if (s === "PENDING") return "maia-status-badge--pending"
  return "maia-status-badge--unknown"
}

function operationStatusIcon(status: string): { Icon: IconType | null; className?: string } {
  const s = toCanonicalOperationStatus(status)
  if (s === "RUNNING") return { Icon: Spinner }
  if (s === "PENDING") return { Icon: Clock }
  if (s === "SUCCEEDED") return { Icon: CheckCircle2 }
  if (s === "FAILED") return { Icon: XCircle }
  return { Icon: null }
}

/**
 * Single entrypoint for Operation status UI styling (icon + CSS vars + convenience classes).
 *
 * Design:
 * - Operation status is DB-backed (Prisma enum spelling); there are currently no UI-only statuses.
 * - Callers should prefer consuming this spec over composing icon/color/badge logic manually.
 */
export function operationStatusUiSpec(status: string): OperationStatusUiSpec {
  const s = toCanonicalOperationStatus(status)
  const vars = operationStatusVarsClassName(s)
  const icon = operationStatusIcon(s)
  return {
    ...baseVarsSpec(s, vars),
    Icon: icon.Icon ?? null,
    iconClassName: icon.className,
  }
}
