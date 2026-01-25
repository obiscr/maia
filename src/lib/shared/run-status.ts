import type { ComponentType } from "react"
import { Ban, CheckCircle2, Clock, Inbox, SkipForward, XCircle } from "lucide-react"

import { Spinner } from "@/components/ui/spinner"

export function toCanonicalRunStatus(s: string) {
  const up = (s || "").toUpperCase()
  // Support both spellings, but canonicalize to the Prisma enum spelling.
  if (up === "CANCELLED") return "CANCELED"
  return up
}

export function toUiRunStatus(status: string, cancelRequestedAt?: unknown) {
  const s = toCanonicalRunStatus(status)
  const hasCancelRequestedAt = cancelRequestedAt != null && String(cancelRequestedAt || "").trim() !== ""
  if (!hasCancelRequestedAt) return s
  // UI-only status: cancel is requested but the run is not terminal yet.
  if (s === "RUNNING" || s === "PENDING_INPUTS") return "CANCELING"
  return s
}

type IconType = ComponentType<{ className?: string }>

export type StatusUiVarsSpec = {
  /**
   * Canonicalized status string (uppercase; CANCELLED -> CANCELED).
   * May include UI-only statuses like CANCELING (derived from cancelRequestedAt).
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

export type RunStatusUiSpec = StatusUiVarsSpec & StatusUiIconSpec

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

function runStatusVarsClassName(status: string) {
  const s = toCanonicalRunStatus(status)
  if (s === "FAILED") return "maia-status-badge--failed"
  if (s === "SUCCEEDED") return "maia-status-badge--succeeded"
  if (s === "RUNNING") return "maia-status-badge--running"
  if (s === "CANCELING") return "maia-status-badge--pending"
  if (s === "PENDING" || s === "PENDING_INPUTS") return "maia-status-badge--pending"
  if (s === "BLOCKED") return "maia-status-badge--blocked"
  if (s === "SKIPPED") return "maia-status-badge--skipped"
  if (s === "INTERRUPTED") return "maia-status-badge--interrupted"
  if (s === "CANCELED") return "maia-status-badge--canceled"
  return "maia-status-badge--unknown"
}

function runStatusIcon(status: string): { Icon: IconType | null; className?: string } {
  const s = toCanonicalRunStatus(status)
  if (s === "RUNNING") return { Icon: Spinner }
  if (s === "CANCELING") return { Icon: Spinner }
  if (s === "PENDING" || s === "BLOCKED" || s === "INTERRUPTED") return { Icon: Clock }
  if (s === "PENDING_INPUTS") return { Icon: Inbox }
  if (s === "SUCCEEDED") return { Icon: CheckCircle2 }
  if (s === "FAILED") return { Icon: XCircle }
  if (s === "CANCELED") return { Icon: Ban }
  if (s === "SKIPPED") return { Icon: SkipForward }
  return { Icon: null }
}

/**
 * Single entrypoint for Run status UI styling (icon + CSS vars + convenience classes).
 *
 * Design:
 * - The DB status remains stable (Prisma enum spelling); UI may derive CANCELING.
 * - Callers should prefer consuming this spec over composing icon/color/badge logic manually.
 */
export function runStatusUiSpec(status: string): RunStatusUiSpec {
  const s = toCanonicalRunStatus(status)
  const vars = runStatusVarsClassName(s)
  const icon = runStatusIcon(s)
  return {
    ...baseVarsSpec(s, vars),
    Icon: icon.Icon ?? null,
    iconClassName: icon.className,
  }
}
