"use client"

import {
  Ban,
  Calendar,
  CheckCircle2,
  Clock3,
  Copy,
  Hourglass,
  Layers,
  Link2,
  MoreHorizontal,
  PauseCircle,
  Play,
  WorkflowIcon,
  XCircle,
} from "lucide-react"
import * as React from "react"

import { CommonListItem } from "@/components/common/common-list-item"
import { CopyableIdBadge } from "@/components/common/copyable-id-badge"
import { InlineItemRow, type InlineItemRowItem } from "@/components/common/inline-item-row"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
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
import { batchStatusUiSpec, toCanonicalBatchStatus } from "@/lib/shared/batch-status"
import { batchControlAvailability } from "@/lib/shared/batch-control"
import { cn } from "@/lib/utils"

export type BatchesListItemModel = {
  id: string
  title: string
  status: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  jobsTotal?: number | null
  jobsByStatus?: Record<string, number> | null
  workflowId?: string | null
  workflowName?: string | null
  // Optional list metadata (may be used by pages even if item UI ignores it)
  pinnedWorkflowVersionNumber?: number | null
  concurrencyLimit?: number | null
  rampUpSeconds?: number | null
  autoMaxConcurrency?: number | null
  failFast?: boolean | null
  maxFailures?: number | null
  urlFilesCount?: number | null
  provenance?: {
    source?: string | null
    owner?: string | null
    ticket?: string | null
    dataset?: string | null
  } | null
}

function BatchesTimingRow(props: {
  className?: string
  createdRel: string
  isCompleted: boolean
  durationMs: number | null
  formatDurationMs: (ms: number | null) => string
  queuedAtTitle: string
  runDurationTitle: string
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
      ) : null}
    </div>
  )
}

type BatchesListItemActions = {
  copyId?: () => void | Promise<void>
  copyLink?: () => void | Promise<void>
  pause?: () => void | Promise<void>
  resume?: () => void | Promise<void>
  cancel?: () => void | Promise<void>
}

export function BatchesCommonListItem(props: {
  locale: Locale
  model: BatchesListItemModel
  href: string
  formatDurationMs: (ms: number | null) => string
  statusLabel: (s: string) => string
  actions?: BatchesListItemActions
}) {
  const { t } = useI18n()
  const { model: b } = props
  const canonical = toCanonicalBatchStatus(b.status)
  const ui = batchStatusUiSpec(canonical)
  const durationMs = calcDurationMs(b.startedAt, b.finishedAt)
  const createdRel = formatRelativeTimeFromNow(b.createdAt, { locale: props.locale })
  const isCompleted = !!b.finishedAt
  const jobsTotal = typeof b.jobsTotal === "number" ? b.jobsTotal : null
  const jobsByStatus = b.jobsByStatus ?? null

  const wfId = typeof b.workflowId === "string" && b.workflowId.trim() ? b.workflowId : null
  const wfName = typeof b.workflowName === "string" && b.workflowName.trim() ? b.workflowName : null
  const showWfNameInline = !!wfName && String(b.title ?? "").trim() !== wfName

  const statusCounts = React.useMemo(() => {
    const get = (k: string) => {
      const n = Number(jobsByStatus?.[k])
      return Number.isFinite(n) && n >= 0 ? n : 0
    }
    return {
      queued: get("QUEUED"),
      paused: get("PAUSED"),
      running: get("RUNNING"),
      succeeded: get("SUCCEEDED"),
      failed: get("FAILED"),
      canceled: get("CANCELED"),
    }
  }, [jobsByStatus])

  const statsItems = React.useMemo((): InlineItemRowItem[] => {
    const items: InlineItemRowItem[] = []
    const statusIconClass = (status: string) => {
      const s = toCanonicalBatchStatus(status)
      const ui = batchStatusUiSpec(s)
      return cn(ui.varsClassName, ui.textClassName)
    }
    const pendingIconClass = cn("maia-status-badge--pending", "text-[color:var(--maia-status-text)]")

    items.push({
      key: "total",
      title: t("batches.jobsTotal"),
      Icon: Layers,
      text: jobsTotal ?? "—",
    })

    if (statusCounts.running > 0) {
      items.push({
        key: "running",
        title: t("common.statusValues.running"),
        Icon: Spinner,
        iconClassName: statusIconClass("RUNNING"),
        text: statusCounts.running,
      })
    }
    if (statusCounts.failed > 0) {
      items.push({
        key: "failed",
        title: t("common.statusValues.failed"),
        Icon: XCircle,
        iconClassName: statusIconClass("FAILED"),
        text: statusCounts.failed,
      })
    }
    if (statusCounts.succeeded > 0) {
      items.push({
        key: "succeeded",
        title: t("common.statusValues.succeeded"),
        Icon: CheckCircle2,
        iconClassName: statusIconClass("SUCCEEDED"),
        text: statusCounts.succeeded,
      })
    }
    if (statusCounts.queued > 0) {
      items.push({
        key: "queued",
        title: t("common.statusValues.queued"),
        Icon: Hourglass,
        iconClassName: pendingIconClass,
        text: statusCounts.queued,
      })
    }
    if (statusCounts.paused > 0) {
      items.push({
        key: "paused",
        title: t("common.statusValues.paused"),
        Icon: PauseCircle,
        iconClassName: statusIconClass("PAUSED"),
        text: statusCounts.paused,
      })
    }
    if (statusCounts.canceled > 0) {
      items.push({
        key: "canceled",
        title: t("common.statusValues.canceled"),
        Icon: Ban,
        iconClassName: statusIconClass("CANCELED"),
        text: statusCounts.canceled,
      })
    }

    return items
  }, [jobsTotal, statusCounts, t])

  const leftColumn = (
    <ItemContent className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        {ui.Icon ? (
          <span className="shrink-0">
            <ui.Icon
              aria-hidden="true"
              className={cn("size-4.5 shrink-0", ui.iconClassName, ui.varsClassName, ui.textClassName)}
            />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <ItemTitle className="w-full min-w-0 text-base leading-snug">
              <span className="block truncate">{b.title}</span>
            </ItemTitle>
          </div>
        </div>
      </div>

      <ItemDescription className="mt-1 pl-7 line-clamp-1">
        <span className="inline-flex flex-wrap items-center gap-2">
          <CopyableIdBadge id={b.id} Icon={Layers} />
          {wfId ? <CopyableIdBadge id={wfId} Icon={WorkflowIcon} /> : null}
          {showWfNameInline ? <span className="min-w-0">{wfName}</span> : null}
        </span>
      </ItemDescription>

      <InlineItemRow
        className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-muted-foreground"
        items={statsItems}
      />

      <BatchesTimingRow
        className="mt-1 flex flex-wrap items-center gap-2 pl-7 text-xs text-muted-foreground md:hidden"
        createdRel={createdRel}
        isCompleted={isCompleted}
        durationMs={durationMs}
        formatDurationMs={props.formatDurationMs}
        queuedAtTitle={t("jobs.list.queuedAtTitle")}
        runDurationTitle={t("jobs.list.runDurationTitle")}
      />
    </ItemContent>
  )

  const middleColumn = (
    <BatchesTimingRow
      className="flex flex-col items-start gap-1 pt-0.5 text-xs text-muted-foreground"
      createdRel={createdRel}
      isCompleted={isCompleted}
      durationMs={durationMs}
      formatDurationMs={props.formatDurationMs}
      queuedAtTitle={t("jobs.list.queuedAtTitle")}
      runDurationTitle={t("jobs.list.runDurationTitle")}
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

  const actions = (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("common.actions")}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          {(() => {
            const avail = batchControlAvailability({
              canonicalStatus: canonical,
              statusCounts: { queued: statusCounts.queued, paused: statusCounts.paused, running: statusCounts.running },
            })
            const canPause = !!props.actions?.pause && avail.canPause
            const canResume = !!props.actions?.resume && avail.canResume
            const canCancel = !!props.actions?.cancel && avail.canCancel
            const showAny = canPause || canResume || canCancel
            if (!showAny) return null
            return (
              <>
                {canPause ? (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault()
                      void props.actions?.pause?.()
                    }}
                  >
                    <PauseCircle className="size-4" />
                    {t("batches.controlPauseAction")}
                  </DropdownMenuItem>
                ) : null}
                {canResume ? (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault()
                      void props.actions?.resume?.()
                    }}
                  >
                    <Play className="size-4" />
                    {t("batches.controlResumeAction")}
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
                    {t("batches.controlCancelAction")}
                  </DropdownMenuItem>
                ) : null}
                {props.actions?.copyId || props.actions?.copyLink ? <DropdownMenuSeparator /> : null}
              </>
            )
          })()}
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
  )

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
