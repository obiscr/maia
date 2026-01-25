import type { ComponentType } from "react"
import { Ban, CheckCircle2, Clock, ListChecks, PauseCircle, XCircle } from "lucide-react"

import { Spinner } from "@/components/ui/spinner"

export function toCanonicalJobStatus(s: string) {
  const up = (s || "").toUpperCase()
  // Support both spellings, but canonicalize to the Prisma enum spelling.
  if (up === "CANCELLED") return "CANCELED"
  return up
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

export type JobStatusUiSpec = StatusUiVarsSpec & StatusUiIconSpec
export type JobAttemptStatusUiSpec = StatusUiVarsSpec & StatusUiIconSpec

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

function jobStatusVarsClassName(status: string) {
  const s = toCanonicalJobStatus(status)
  if (s === "FAILED") return "maia-status-badge--failed"
  if (s === "SUCCEEDED") return "maia-status-badge--succeeded"
  if (s === "RUNNING") return "maia-status-badge--running"
  if (s === "PAUSED") return "maia-status-badge--paused"
  if (s === "CANCELING") return "maia-status-badge--pending"
  if (s === "QUEUED") return "maia-status-badge--pending"
  if (s === "CANCELED") return "maia-status-badge--canceled"
  return "maia-status-badge--unknown"
}

function jobStatusIcon(status: string): { Icon: IconType | null; className?: string } {
  const s = toCanonicalJobStatus(status)
  if (s === "RUNNING") return { Icon: Spinner }
  if (s === "CANCELING") return { Icon: Spinner }
  if (s === "QUEUED") return { Icon: Clock }
  if (s === "PAUSED") return { Icon: PauseCircle }
  if (s === "SUCCEEDED") return { Icon: CheckCircle2 }
  if (s === "FAILED") return { Icon: XCircle }
  if (s === "CANCELED") return { Icon: Ban }
  return { Icon: ListChecks }
}

function jobAttemptIcon(status: string): { Icon: IconType | null; className?: string } {
  const s = String(status || "").toUpperCase()
  if (s === "RUNNING") return { Icon: Spinner }
  if (s === "SUCCEEDED") return { Icon: CheckCircle2, className: "" }
  if (s === "FAILED") return { Icon: XCircle, className: "" }
  if (s === "CANCELED") return { Icon: Ban, className: "" }
  if (s === "ABANDONED") return { Icon: Clock, className: "" }
  return { Icon: null }
}

/**
 * Single entrypoint for Job status UI styling (icon + CSS vars + convenience classes).
 *
 * Design:
 * - The DB status remains stable (Prisma enum spelling); UI may derive CANCELING.
 * - Callers should prefer consuming this spec over composing icon/color/badge logic manually.
 */
export function jobStatusUiSpec(status: string): JobStatusUiSpec {
  const s = toCanonicalJobStatus(status)
  const vars = jobStatusVarsClassName(s)
  const icon = jobStatusIcon(s)
  return {
    ...baseVarsSpec(s, vars),
    Icon: icon.Icon ?? null,
    iconClassName: icon.className,
  }
}

/**
 * Single entrypoint for JobAttempt status UI styling (icon + CSS vars + convenience classes).
 *
 * NOTE: Attempt statuses are different from Run/Step statuses. Keep this mapping local.
 */
export function jobAttemptStatusUiSpec(status: string): JobAttemptStatusUiSpec {
  const s = String(status || "").toUpperCase()
  const vars = (() => {
    if (s === "FAILED") return "maia-status-badge--failed"
    if (s === "SUCCEEDED") return "maia-status-badge--succeeded"
    if (s === "RUNNING") return "maia-status-badge--running"
    if (s === "ABANDONED") return "maia-status-badge--pending"
    if (s === "CANCELED") return "maia-status-badge--canceled"
    return "maia-status-badge--unknown"
  })()
  const icon = jobAttemptIcon(s)
  return {
    ...baseVarsSpec(s, vars),
    Icon: icon.Icon ?? null,
    iconClassName: icon.className,
  }
}
