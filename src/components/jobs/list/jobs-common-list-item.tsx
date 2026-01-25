"use client"

import {
  AlertCircle,
  Ban,
  Calendar,
  Clock3,
  Copy,
  History,
  Layers,
  Link2,
  ListChecks,
  MoreHorizontal,
  Play,
  Server,
  Timer,
  WorkflowIcon,
} from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { CommonListItem } from "@/components/common/common-list-item"
import { CopyableIdBadge } from "@/components/common/copyable-id-badge"
import { InlineItemRow, type InlineItemRowItem } from "@/components/common/inline-item-row"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import type { Locale } from "@/lib/shared/i18n/constants"
import { calcDurationMs, formatRelativeTimeFromNow } from "@/lib/shared/format/time"
import { resolveJobDisplayError } from "@/lib/shared/error-display/adapters/job"
import { jobStatusUiSpec, toCanonicalJobStatus } from "@/lib/shared/job-status"
import { jobControlAvailability } from "@/lib/shared/job-control"
import { cn } from "@/lib/utils"

export type JobsListItemModel = {
  id: string
  title: string
  status: string
  cancelRequestedAt?: string | null
  runCancelRequestedAt?: string | null
  runStatus?: string | null
  workflowId?: string | null
  scheduledFor?: string | null
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  nextAttemptAt?: string | null
  claimedBy?: string | null
  claimedAt?: string | null
  leaseExpiresAt?: string | null
  runId?: string | null
  attemptCount?: number | null
  maxAttempts?: number | null
  lastErrorCode?: string | null
  lastErrorMessage?: string | null
  lastErrorMetaJson?: string | null
  lastErrorAt?: string | null
  scheduleId?: string | null
  scheduleName?: string | null
  batchId?: string | null
  batchName?: string | null
}

type JobsListItemActions = {
  copyId?: () => void | Promise<void>
  copyLink?: () => void | Promise<void>
  resume?: () => void | Promise<void>
  cancel?: () => void | Promise<void>
}

function JobsTimingRow(props: {
  className?: string
  createdRel: string
  isCompleted: boolean
  durationMs: number | null
  formatDurationMs: (ms: number | null) => string
  queuedAtTitle: string
  runDurationTitle: string
  statusLabel: string
  statusIcon: {
    Icon: React.ComponentType<{ className?: string }> | null
    iconClassName?: string
    varsClassName: string
    textClassName: string
  }
}) {
  return (
    <div className={props.className}>
      <span className="inline-flex items-center gap-1" title={props.queuedAtTitle}>
        <Calendar className="size-3.5" aria-hidden="true" />
        {props.createdRel}
      </span>
      {props.isCompleted ? (
        <span className="inline-flex items-center gap-1" title={props.runDurationTitle}>
          <Clock3 className="size-3.5" aria-hidden="true" />
          {props.durationMs == null ? "—" : props.formatDurationMs(props.durationMs)}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1">
          {props.statusIcon.Icon ? (
            <props.statusIcon.Icon
              aria-hidden="true"
              className={[
                "size-3.5 shrink-0",
                props.statusIcon.iconClassName,
                props.statusIcon.varsClassName,
                props.statusIcon.textClassName,
              ]
                .filter(Boolean)
                .join(" ")}
            />
          ) : null}
          {props.statusLabel}
        </span>
      )}
    </div>
  )
}

function TriggerInfo(props: {
  scheduleId?: string | null
  batchId?: string | null
  scheduleName?: string | null
  batchName?: string | null
  t: (k: string, vars?: Record<string, string | number>) => string
}): {
  label: string
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  tooltip?: string
} {
  const hasSchedule = typeof props.scheduleId === "string" && props.scheduleId.trim().length > 0
  const hasBatch = typeof props.batchId === "string" && props.batchId.trim().length > 0

  if (hasSchedule)
    return {
      label: props.t("jobs.list.triggerSchedule"),
      Icon: Calendar,
      tooltip: props.t("jobs.list.triggerTooltipSchedule", {
        name: props.scheduleName ?? "—",
        id: props.scheduleId ?? "—",
      }),
    }
  if (hasBatch)
    return {
      label: props.t("jobs.list.triggerBatch"),
      Icon: Layers,
      tooltip: props.t("jobs.list.triggerTooltipBatch", { name: props.batchName ?? "—", id: props.batchId ?? "—" }),
    }
  return { label: props.t("common.source.manual"), Icon: Play }
}

export function JobsCommonListItem(props: {
  locale: Locale
  model: JobsListItemModel
  href: string
  formatDurationMs: (ms: number | null) => string
  statusLabel: (s: string) => string
  showScheduledFor?: boolean
  showActions?: boolean
  actions?: JobsListItemActions
}) {
  const { t } = useI18n()
  const { model: j } = props
  const showActions = props.showActions !== false
  const canonical = toCanonicalJobStatus(j.status)
  const ctl = jobControlAvailability({
    canonicalJobStatus: canonical,
    jobCancelRequestedAtIso: j.cancelRequestedAt ?? null,
    runCancelRequestedAtIso: j.runCancelRequestedAt ?? null,
    runStatus: j.runStatus ?? null,
  })
  const icon = jobStatusUiSpec(ctl.uiStatus)
  const durationMs = calcDurationMs(j.startedAt, j.finishedAt)
  const createdRel = formatRelativeTimeFromNow(j.queuedAt, { locale: props.locale })
  const isCompleted = !!j.finishedAt
  const scheduledForIso = props.showScheduledFor ? (j.scheduledFor ? String(j.scheduledFor) : null) : null
  const scheduledForRel = scheduledForIso ? formatRelativeTimeFromNow(scheduledForIso, { locale: props.locale }) : null
  const waitMs = calcDurationMs(j.queuedAt, j.startedAt ?? null)

  const nextAttemptIso = j.nextAttemptAt ? String(j.nextAttemptAt) : null
  const nextAttemptRel = nextAttemptIso ? formatRelativeTimeFromNow(nextAttemptIso, { locale: props.locale }) : null

  const leaseIso = j.leaseExpiresAt ? String(j.leaseExpiresAt) : null
  const leaseRel = leaseIso ? formatRelativeTimeFromNow(leaseIso, { locale: props.locale }) : null

  // Legacy dev marker - do not show it to users.
  const claimedBy = j.claimedBy === "maia.engine.module" ? null : j.claimedBy

  const lastErrorCodeRaw = j.lastErrorCode ? String(j.lastErrorCode) : null
  const lastErrorMessage = j.lastErrorMessage ? String(j.lastErrorMessage) : null
  const lastErrorMetaJson = j.lastErrorMetaJson ? String(j.lastErrorMetaJson) : null
  const displayError = React.useMemo(
    () =>
      resolveJobDisplayError({
        errorCode: lastErrorCodeRaw,
        errorMessage: lastErrorMessage,
        errorMetaJson: lastErrorMetaJson,
      }),
    [lastErrorCodeRaw, lastErrorMessage, lastErrorMetaJson],
  )
  const displayErrorCode = displayError.displayCode

  const attemptText =
    typeof j.attemptCount === "number" && typeof j.maxAttempts === "number"
      ? `${j.attemptCount}/${j.maxAttempts}`
      : null

  const trigger = TriggerInfo({
    scheduleId: j.scheduleId,
    batchId: j.batchId,
    scheduleName: j.scheduleName,
    batchName: j.batchName,
    t,
  })

  const showScheduledForStat = React.useMemo(() => {
    if (!scheduledForIso) return false
    try {
      const s = new Date(scheduledForIso).getTime()
      const q = new Date(j.queuedAt).getTime()
      if (Number.isNaN(s) || Number.isNaN(q)) return true
      return Math.abs(s - q) > 30_000 // only show if meaningfully different from queuedAt
    } catch {
      return true
    }
  }, [j.queuedAt, scheduledForIso])

  const statsItems = React.useMemo((): InlineItemRowItem[] => {
    const items: InlineItemRowItem[] = []
    items.push({
      key: "trigger",
      title: t("jobs.list.triggerTitle"),
      Icon: trigger.Icon,
      text: trigger.label,
      tooltip: trigger.tooltip,
    })
    if (showScheduledForStat && scheduledForRel)
      items.push({
        key: "scheduledFor",
        title: t("jobs.list.plannedTimeTitle"),
        Icon: Calendar,
        text: scheduledForRel,
        tooltip: scheduledForIso ? t("jobs.list.plannedTimeTooltip", { iso: scheduledForIso }) : undefined,
      })
    items.push({
      key: "wait",
      title: t("jobs.list.queueDelayTitle"),
      Icon: Clock3,
      text: waitMs == null ? "—" : props.formatDurationMs(waitMs),
    })
    if (nextAttemptRel && !isCompleted) {
      items.push({
        key: "nextAttempt",
        title: t("jobs.list.nextAttemptTitle"),
        Icon: Timer,
        text: nextAttemptRel,
        tooltip: nextAttemptIso ? t("jobs.list.nextAttemptTooltip", { iso: nextAttemptIso }) : undefined,
      })
    }
    if (canonical === "RUNNING" && typeof claimedBy === "string" && claimedBy.trim()) {
      items.push({
        key: "worker",
        title: t("jobs.list.workerTitle"),
        Icon: Server,
        text: claimedBy,
        tooltip:
          typeof j.claimedAt === "string" && j.claimedAt.trim()
            ? t("jobs.list.workerTooltip", { by: claimedBy, iso: j.claimedAt })
            : undefined,
      })
    }
    if (canonical === "RUNNING" && leaseRel) {
      items.push({
        key: "lease",
        title: t("jobs.list.leaseTitle"),
        Icon: Timer,
        text: leaseRel,
        tooltip: leaseIso ? t("jobs.list.leaseTooltip", { iso: leaseIso }) : undefined,
      })
    }
    if (attemptText) {
      items.push({
        key: "attempts",
        title: t("jobs.list.attemptsTitle"),
        Icon: History,
        text: attemptText,
      })
    }
    if (canonical === "FAILED" && (displayErrorCode || lastErrorCodeRaw || lastErrorMessage)) {
      items.push({
        key: "error",
        title: t("common.errorLabel"),
        Icon: AlertCircle,
        iconClassName: "text-destructive",
        text: (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-[11px] text-destructive">{displayErrorCode ?? "UNKNOWN"}</span>
          </span>
        ),
        tooltip:
          displayError.wrapperCode && displayError.wrapperCode !== displayErrorCode
            ? `${displayError.wrapperCode}${displayError.wrapperMessage ? `: ${displayError.wrapperMessage}` : ""}`
            : (lastErrorMessage ?? lastErrorCodeRaw ?? undefined),
      })
    }
    return items
  }, [
    attemptText,
    canonical,
    claimedBy,
    displayError.wrapperCode,
    displayError.wrapperMessage,
    displayErrorCode,
    isCompleted,
    j.claimedAt,
    lastErrorCodeRaw,
    lastErrorMessage,
    leaseIso,
    leaseRel,
    nextAttemptIso,
    nextAttemptRel,
    props,
    scheduledForIso,
    scheduledForRel,
    showScheduledForStat,
    t,
    trigger.Icon,
    trigger.label,
    trigger.tooltip,
    waitMs,
  ])

  const leftColumn = (
    <ItemContent className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        {icon.Icon ? (
          <span className="shrink-0">
            <icon.Icon
              aria-hidden="true"
              className={cn("size-4.5 shrink-0", icon.iconClassName, icon.varsClassName, icon.textClassName)}
            />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <ItemTitle className="w-full min-w-0 text-base leading-snug">
              <span className="block truncate">{j.title}</span>
            </ItemTitle>
          </div>
        </div>
      </div>

      <ItemDescription className="mt-1 pl-7 line-clamp-1">
        <span className="inline-flex flex-wrap items-center gap-2">
          <CopyableIdBadge id={j.id} Icon={ListChecks} />
          {j.runId ? <CopyableIdBadge id={j.runId} Icon={Play} /> : null}
          {j.workflowId ? <CopyableIdBadge id={j.workflowId} Icon={WorkflowIcon} /> : null}
          {j.scheduleId ? <CopyableIdBadge id={j.scheduleId} Icon={Calendar} /> : null}
          {j.batchId ? <CopyableIdBadge id={j.batchId} Icon={Layers} /> : null}
        </span>
      </ItemDescription>

      <InlineItemRow
        className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-muted-foreground"
        items={statsItems}
      />

      <JobsTimingRow
        className="mt-1 flex flex-wrap items-center gap-2 pl-7 text-xs text-muted-foreground md:hidden"
        createdRel={createdRel}
        isCompleted={isCompleted}
        durationMs={durationMs}
        formatDurationMs={props.formatDurationMs}
        queuedAtTitle={t("jobs.list.queuedAtTitle")}
        runDurationTitle={t("jobs.list.runDurationTitle")}
        statusLabel={props.statusLabel(j.status)}
        statusIcon={icon}
      />
    </ItemContent>
  )

  const middleColumn = (
    <JobsTimingRow
      className="flex flex-col items-start gap-1 pt-0.5 text-xs text-muted-foreground"
      createdRel={createdRel}
      isCompleted={isCompleted}
      durationMs={durationMs}
      formatDurationMs={props.formatDurationMs}
      queuedAtTitle={t("jobs.list.queuedAtTitle")}
      runDurationTitle={t("jobs.list.runDurationTitle")}
      statusLabel={props.statusLabel(j.status)}
      statusIcon={icon}
    />
  )

  const middleCollapsed = (
    <span className="inline-flex min-w-0 items-center gap-3">
      <span className="inline-flex min-w-0 items-center gap-1">
        <Calendar className="size-3.5" aria-hidden="true" />
        <span className="truncate">{createdRel}</span>
      </span>
      <span className="inline-flex min-w-0 items-center gap-1">
        <Clock3 className="size-3.5" aria-hidden="true" />
        <span className="truncate">{durationMs == null ? "—" : props.formatDurationMs(durationMs)}</span>
      </span>
    </span>
  )

  const canCancel = !!props.actions?.cancel && ctl.canCancel
  const canResume = !!props.actions?.resume && ctl.canResume
  const showCopy = !!props.actions?.copyId || !!props.actions?.copyLink

  const actions = showActions ? (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("common.actions")}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          {canResume ? (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                void props.actions?.resume?.()
              }}
            >
              <Play className="size-4" />
              {t("jobs.list.actions.startAction")}
            </DropdownMenuItem>
          ) : null}
          {canCancel ? (
            <DropdownMenuItem
              variant="destructive"
              onSelect={(e) => {
                e.preventDefault()
                void props.actions?.cancel?.()
              }}
            >
              <Ban className="size-4" />
              {t("jobs.list.actions.cancelJobAction")}
            </DropdownMenuItem>
          ) : null}
          {canResume || canCancel ? <DropdownMenuSeparator /> : null}

          {j.workflowId ? (
            <DropdownMenuItem asChild>
              <Link href={`/workflows/${j.workflowId}`} className="cursor-pointer">
                <WorkflowIcon className="size-4" />
                {t("jobs.list.actions.openWorkflowAction")}
              </Link>
            </DropdownMenuItem>
          ) : null}
          {j.runId ? (
            <DropdownMenuItem asChild>
              <Link href={`/runs/${j.runId}`} className="cursor-pointer">
                <Play className="size-4" />
                {t("jobs.list.actions.openRunAction")}
              </Link>
            </DropdownMenuItem>
          ) : null}

          {showCopy ? <DropdownMenuSeparator /> : null}
          {props.actions?.copyId ? (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                void props.actions?.copyId?.()
              }}
            >
              <Copy className="size-4" />
              {t("common.copyActionIdAction")}
            </DropdownMenuItem>
          ) : null}
          {props.actions?.copyLink ? (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                void props.actions?.copyLink?.()
              }}
            >
              <Link2 className="size-4" />
              {t("common.copyActionLinkAction")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ) : null

  return (
    <CommonListItem
      href={props.href}
      columns={[
        { key: "left", content: leftColumn, showOnMobile: true },
        {
          key: "middle",
          content: middleColumn,
          collapsedContent: middleCollapsed,
          minWidthPx: 200,
          collapsePriority: 50,
        },
      ]}
      actions={actions}
    />
  )
}
