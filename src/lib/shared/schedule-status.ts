import type { ComponentType } from "react"
import { CheckCircle2, CircleSlash, Clock, TriangleAlertIcon, XCircle } from "lucide-react"

type IconType = ComponentType<{ className?: string }>

export function toCanonicalScheduleStatus(s: string) {
  const up = (s || "").toUpperCase()
  // Schedule status is intentionally simple: it's a DB-backed boolean (enabled/disabled),
  // represented in the UI as the canonical strings below.
  if (up === "ENABLED") return "ENABLED"
  if (up === "DISABLED") return "DISABLED"
  return up
}

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

export type ScheduleStatusUiSpec = StatusUiVarsSpec & StatusUiIconSpec

export type ScheduleJsonStatusUiSpec = StatusUiVarsSpec & StatusUiIconSpec

function baseVarsSpec(status: string, varsClassName: string): StatusUiVarsSpec {
  return {
    status,
    varsClassName,
    textClassName: "text-[color:var(--maia-status-text)]",
    containerClassName: "bg-[var(--maia-status-bg)] border-[var(--maia-status-border)]",
    borderClassName: "border-[var(--maia-status-border)]",
  }
}

function scheduleStatusVarsClassName(status: string) {
  const s = toCanonicalScheduleStatus(status)
  if (s === "ENABLED") return "maia-status-badge--running"
  if (s === "DISABLED") return "maia-status-badge--paused"
  return "maia-status-badge--unknown"
}

function scheduleStatusIcon(status: string): { Icon: IconType | null; className?: string } {
  const s = toCanonicalScheduleStatus(status)
  if (s === "ENABLED") return { Icon: Clock }
  if (s === "DISABLED") return { Icon: CircleSlash }
  return { Icon: null }
}

/**
 * Single entrypoint for Schedule status UI styling (icon + CSS vars + convenience classes).
 *
 * Design:
 * - Schedule has only two DB-backed statuses: ENABLED / DISABLED.
 * - Callers should prefer consuming this spec over composing icon/color/badge logic manually.
 */
export function scheduleStatusUiSpec(status: string): ScheduleStatusUiSpec {
  const s = toCanonicalScheduleStatus(status)
  const vars = scheduleStatusVarsClassName(s)
  const icon = scheduleStatusIcon(s)
  return {
    ...baseVarsSpec(s, vars),
    Icon: icon.Icon ?? null,
    iconClassName: icon.className,
  }
}

export type ScheduleJsonUiStatus = "NOT_CONFIGURED" | "VALID" | "INVALID"

export function toCanonicalScheduleJsonStatus(s: string): ScheduleJsonUiStatus {
  const up = String(s || "").toUpperCase()
  if (up === "NOT_CONFIGURED") return "NOT_CONFIGURED"
  if (up === "VALID") return "VALID"
  return "INVALID"
}

export function scheduleJsonStatusUiSpec(status: ScheduleJsonUiStatus): ScheduleJsonStatusUiSpec {
  const s = toCanonicalScheduleJsonStatus(status)
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
