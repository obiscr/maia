"use client"

import * as React from "react"
import { Clock } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { Badge } from "@/components/ui/badge"
import { formatDurationMs } from "@/lib/shared/format/time"
import { runStatusUiSpec, toCanonicalRunStatus } from "@/lib/shared/run-status"
import { cn } from "@/lib/utils"

function useStatusLabel() {
  const { t } = useI18n()
  return React.useCallback(
    (status: string) => {
      const s = toCanonicalRunStatus(status)
      if (s === "SUCCEEDED") return t("common.statusValues.succeeded")
      if (s === "FAILED") return t("common.statusValues.failed")
      if (s === "RUNNING") return t("common.statusValues.running")
      if (s === "CANCELING") return t("common.statusValues.canceling")
      if (s === "BLOCKED") return t("runs.statusBlocked")
      if (s === "PENDING_INPUTS") return t("common.statusValues.queuedInputs")
      if (s === "CANCELED") return t("common.statusValues.canceled")
      if (s === "SKIPPED") return t("runs.statusSkipped")
      if (s === "INTERRUPTED") return t("runs.statusInterrupted")
      return status || "—"
    },
    [t],
  )
}

export function RunStatusBadge(props: { status: string }) {
  const statusLabel = useStatusLabel()
  const s = toCanonicalRunStatus(props.status)
  const label = statusLabel(s)
  const spec = runStatusUiSpec(s)
  return (
    <Badge variant="outline" className={cn("maia-status-badge", spec.varsClassName)}>
      <span className="inline-flex items-center gap-1.5">
        {spec.Icon ? <spec.Icon className={cn("h-3.5 w-3.5", spec.iconClassName)} aria-hidden="true" /> : null}
        <span>{label}</span>
      </span>
    </Badge>
  )
}

export function StepOrAttemptStatusBadge(props: { status: string }) {
  const statusLabel = useStatusLabel()
  const s = toCanonicalRunStatus(props.status)
  const spec = runStatusUiSpec(s)

  return (
    <Badge variant="outline" className={cn("h-5 px-2 text-[11px] uppercase", "maia-status-badge", spec.varsClassName)}>
      <span className="inline-flex items-center gap-1.5">
        {spec.Icon ? <spec.Icon className={cn("h-3.5 w-3.5", spec.iconClassName)} aria-hidden="true" /> : null}
        <span>{statusLabel(s)}</span>
      </span>
    </Badge>
  )
}

export function RunDurationBadge(props: { durationMs: number | null }) {
  const { t } = useI18n()
  return (
    <Badge variant="secondary" className="h-6">
      <span className="inline-flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        <span>
          {t("runs.duration")}: {formatDurationMs(props.durationMs)}
        </span>
      </span>
    </Badge>
  )
}
