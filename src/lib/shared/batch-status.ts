import type { ComponentType } from "react"
import { Ban, CheckCircle2, Clock, PauseCircle, TriangleAlertIcon, XCircle } from "lucide-react"

import { Spinner } from "@/components/ui/spinner"

export function toCanonicalBatchStatus(s: string) {
  const up = (s || "").toUpperCase()
  // Support both spellings, but canonicalize to the Prisma enum spelling.
  if (up === "CANCELLED") return "CANCELED"
  return up
}

type IconType = ComponentType<{ className?: string }>

export type StatusUiVarsSpec = {
  /**
   * Canonicalized status string (uppercase; CANCELLED -> CANCELED).
   * Batch currently has no UI-only statuses (unlike Job/Run CANCELING).
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

export type BatchStatusUiSpec = StatusUiVarsSpec & StatusUiIconSpec

export type BatchJsonStatusUiSpec = StatusUiVarsSpec & StatusUiIconSpec

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

function batchStatusVarsClassName(status: string) {
  const s = toCanonicalBatchStatus(status)
  if (s === "FAILED") return "maia-status-badge--failed"
  if (s === "SUCCEEDED") return "maia-status-badge--succeeded"
  if (s === "RUNNING") return "maia-status-badge--running"
  if (s === "PAUSED") return "maia-status-badge--paused"
  if (s === "CANCELED") return "maia-status-badge--canceled"
  if (s === "CREATED") return "maia-status-badge--pending"
  return "maia-status-badge--unknown"
}

function batchStatusIcon(status: string): { Icon: IconType | null; className?: string } {
  const s = toCanonicalBatchStatus(status)
  if (s === "RUNNING") return { Icon: Spinner }
  if (s === "CREATED") return { Icon: Clock }
  if (s === "PAUSED") return { Icon: PauseCircle }
  if (s === "SUCCEEDED") return { Icon: CheckCircle2 }
  if (s === "FAILED") return { Icon: XCircle }
  if (s === "CANCELED") return { Icon: Ban }
  return { Icon: null }
}

/**
 * Single entrypoint for Batch status UI styling (icon + CSS vars + convenience classes).
 *
 * Design:
 * - The DB status remains stable (Prisma enum spelling); batches currently have no UI-only statuses.
 * - Callers should prefer consuming this spec over composing icon/color/badge logic manually.
 */
export function batchStatusUiSpec(status: string): BatchStatusUiSpec {
  const s = toCanonicalBatchStatus(status)
  const vars = batchStatusVarsClassName(s)
  const icon = batchStatusIcon(s)
  return {
    ...baseVarsSpec(s, vars),
    Icon: icon.Icon ?? null,
    iconClassName: icon.className,
  }
}

export type BatchJsonUiStatus = "NOT_CONFIGURED" | "VALID" | "INVALID"

export function toCanonicalBatchJsonStatus(s: string): BatchJsonUiStatus {
  const up = String(s || "").toUpperCase()
  if (up === "NOT_CONFIGURED") return "NOT_CONFIGURED"
  if (up === "VALID") return "VALID"
  return "INVALID"
}

/**
 * Batch sheet uses the same JSON status palette as schedules (neutral/succeeded/failed),
 * but lives in the batch status module so callers don't reach into schedule-specific code.
 */
export function batchJsonStatusUiSpec(status: BatchJsonUiStatus): BatchJsonStatusUiSpec {
  const s = toCanonicalBatchJsonStatus(status)
  const varsClassName =
    s === "NOT_CONFIGURED"
      ? "maia-status-badge--neutral"
      : s === "VALID"
        ? "maia-status-badge--succeeded"
        : "maia-status-badge--failed"
  const Icon = s === "VALID" ? CheckCircle2 : s === "INVALID" ? XCircle : TriangleAlertIcon
  return {
    ...baseVarsSpec(s, varsClassName),
    Icon,
  }
}
