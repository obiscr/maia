"use client"

import {
  AlertCircle,
  Ban,
  Calendar,
  Clock3,
  Copy,
  History,
  Link2,
  ListChecks,
  MoreHorizontal,
  Package,
  Paperclip,
  Play,
  SlidersHorizontal,
  Tag,
  WorkflowIcon,
} from "lucide-react"
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
import { resolveRunDisplayError } from "@/lib/shared/error-display/adapters/run"
import { runStatusUiSpec, toCanonicalRunStatus, toUiRunStatus } from "@/lib/shared/run-status"
import { runControlAvailability } from "@/lib/shared/run-control"
import { cn } from "@/lib/utils"

export type RunsListItemModel = {
  id: string
  title: string
  status: string
  cancelRequestedAt?: string | null
  failureCode?: string | null
  failureMessage?: string | null
  failureMetaJson?: string | null
  failureAt?: string | null
  workflowId?: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  // Optional secondary "pill" like a branch tag. Kept generic for reuse.
  pill?: string | null
  subtitle?: string | null
  // List meta (optional; helps fill the "middle column" like GitHub Actions)
  stepsTotal?: number | null
  stepsDone?: number | null
  runningStepName?: string | null
  failedStepName?: string | null
  inputParamsCount?: number | null
  inputFilesCount?: number | null
  artifactsCount?: number | null
  attemptsCount?: number | null
}

type RunsListItemActions = {
  cancel?: () => void | Promise<void>
  forceStop?: () => void | Promise<void>
  copyId?: () => void | Promise<void>
  copyLink?: () => void | Promise<void>
}

function RunsTimingRow(props: {
  className?: string
  pill: string | null
  pillIconSizeClass: string
  createdRel: string
  isCompleted: boolean
  durationMs: number | null
  formatDurationMs: (ms: number | null) => string
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
      {props.pill ? (
        <span className="inline-flex items-center gap-1">
          <Tag className={props.pillIconSizeClass} aria-hidden="true" />
          {props.pill}
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1">
        <Calendar className="size-3.5" aria-hidden="true" />
        {props.createdRel}
      </span>
      {props.isCompleted ? (
        <span className="inline-flex items-center gap-1">
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

export function RunsCommonListItem(props: {
  locale: Locale
  model: RunsListItemModel
  href: string
  formatDurationMs: (ms: number | null) => string
  statusLabel: (s: string) => string
  actions?: RunsListItemActions
}) {
  const { t } = useI18n()
  const { model: r } = props
  const uiStatus = toUiRunStatus(r.status, r.cancelRequestedAt)
  const canonical = toCanonicalRunStatus(uiStatus)
  const statusSpec = runStatusUiSpec(canonical)
  const durationMs = calcDurationMs(r.startedAt, r.finishedAt)
  const createdRel = formatRelativeTimeFromNow(r.createdAt, { locale: props.locale })
  const isCompleted = !!r.finishedAt

  const runFailure = React.useMemo(() => {
    return resolveRunDisplayError({
      failureCode: r.failureCode ?? null,
      failureMessage: r.failureMessage ?? null,
      failureMetaJson: r.failureMetaJson ?? null,
    })
  }, [r.failureCode, r.failureMessage, r.failureMetaJson])

  const stepName =
    canonical === "RUNNING" || canonical === "CANCELING"
      ? (r.runningStepName ?? null)
      : canonical === "FAILED"
        ? (r.failedStepName ?? null)
        : null

  const stepsTotal = typeof r.stepsTotal === "number" && Number.isFinite(r.stepsTotal) ? r.stepsTotal : null
  const stepsDone = typeof r.stepsDone === "number" && Number.isFinite(r.stepsDone) ? r.stepsDone : null
  const inputsParams =
    typeof r.inputParamsCount === "number" && Number.isFinite(r.inputParamsCount) ? r.inputParamsCount : null
  const inputsFiles =
    typeof r.inputFilesCount === "number" && Number.isFinite(r.inputFilesCount) ? r.inputFilesCount : null
  const artifactsCount =
    typeof r.artifactsCount === "number" && Number.isFinite(r.artifactsCount) ? r.artifactsCount : null
  const attemptsCount = typeof r.attemptsCount === "number" && Number.isFinite(r.attemptsCount) ? r.attemptsCount : null

  const buildCountItems = React.useCallback((): InlineItemRowItem[] => {
    const items: InlineItemRowItem[] = []
    if (stepsTotal !== null && stepsTotal > 0 && stepsDone !== null) {
      items.push({
        key: "steps",
        title: "Steps",
        Icon: ListChecks,
        text: `${Math.min(stepsDone, stepsTotal)}/${stepsTotal}`,
      })
    }
    if (inputsParams !== null) {
      items.push({
        key: "params",
        title: "Input params",
        Icon: SlidersHorizontal,
        text: inputsParams,
      })
    }
    if (inputsFiles !== null) {
      items.push({
        key: "files",
        title: "Input files",
        Icon: Paperclip,
        text: inputsFiles,
      })
    }
    if (attemptsCount !== null) {
      items.push({
        key: "attempts",
        title: "Attempts",
        Icon: History,
        text: attemptsCount,
      })
    }
    if (artifactsCount !== null) {
      items.push({
        key: "artifacts",
        title: "Artifacts",
        Icon: Package,
        text: artifactsCount,
      })
    }
    if (canonical === "FAILED" && (runFailure.displayCode || runFailure.wrapperCode || runFailure.wrapperMessage)) {
      const displayCode = runFailure.displayCode ?? runFailure.wrapperCode ?? "UNKNOWN"
      const tooltip =
        runFailure.wrapperCode && runFailure.wrapperCode !== displayCode
          ? `${runFailure.wrapperCode}${runFailure.wrapperMessage ? `: ${runFailure.wrapperMessage}` : ""}`
          : (runFailure.wrapperMessage ?? runFailure.wrapperCode ?? undefined)
      items.push({
        key: "error",
        title: "Error",
        Icon: AlertCircle,
        iconClassName: "text-destructive",
        text: <span className="truncate font-mono text-[11px] text-destructive">{String(displayCode)}</span>,
        tooltip,
      })
    }
    return items
  }, [artifactsCount, attemptsCount, canonical, inputsFiles, inputsParams, runFailure, stepsDone, stepsTotal])

  const mobileCountItems = buildCountItems()
  const desktopCountItems = React.useMemo(() => {
    const items = buildCountItems()
    if (stepName) {
      // Prepend stepName on desktop (matches previous behavior).
      const StepIcon = statusSpec.Icon ?? null
      if (StepIcon) {
        items.unshift({
          key: "stepName",
          title: props.statusLabel(uiStatus),
          Icon: StepIcon,
          iconClassName: ["shrink-0 text-muted-foreground", statusSpec.iconClassName].filter(Boolean).join(" "),
          text: <span className="truncate">{stepName}</span>,
        })
      } else {
        items.unshift({
          key: "stepName",
          title: props.statusLabel(uiStatus),
          Icon: ListChecks,
          iconClassName: "opacity-0",
          text: <span className="truncate">{stepName}</span>,
        })
      }
    }
    return items
  }, [buildCountItems, props, statusSpec.Icon, statusSpec.iconClassName, stepName, uiStatus])

  const leftColumn = (
    <ItemContent className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        {statusSpec.Icon ? (
          <span className="shrink-0">
            <statusSpec.Icon
              aria-hidden="true"
              className={cn(
                "size-4.5 shrink-0",
                statusSpec.iconClassName,
                statusSpec.varsClassName,
                statusSpec.textClassName,
              )}
            />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <ItemTitle className="w-full min-w-0 text-base leading-snug">
              <span className="block truncate">{r.title}</span>
            </ItemTitle>
          </div>
        </div>
      </div>

      <ItemDescription className="mt-1 pl-7 line-clamp-1">
        <span className="inline-flex flex-wrap items-center gap-2">
          <CopyableIdBadge id={r.id} Icon={Play} />
          {r.workflowId ? <CopyableIdBadge id={r.workflowId} Icon={WorkflowIcon} /> : null}
        </span>
      </ItemDescription>

      {/* Mobile: show the icon+count meta row too */}
      {mobileCountItems.length ? (
        <InlineItemRow
          className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-muted-foreground md:hidden"
          items={mobileCountItems}
        />
      ) : null}

      {/* Desktop optional meta row */}
      {desktopCountItems.length ? (
        <InlineItemRow
          className="mt-1 hidden flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-muted-foreground md:flex"
          items={desktopCountItems}
        />
      ) : null}

      {/* Mobile/tablet timing/status (below md) */}
      <RunsTimingRow
        className="mt-1 flex flex-wrap items-center gap-2 pl-7 text-xs text-muted-foreground md:hidden"
        pill={r.pill ? String(r.pill) : null}
        pillIconSizeClass="size-3.5"
        createdRel={createdRel}
        isCompleted={isCompleted}
        durationMs={durationMs}
        formatDurationMs={props.formatDurationMs}
        statusLabel={props.statusLabel(uiStatus)}
        statusIcon={statusSpec}
      />
    </ItemContent>
  )

  const middleColumn = (
    <RunsTimingRow
      className="flex flex-col items-start gap-1 pt-0.5 text-xs text-muted-foreground"
      pill={r.pill ? String(r.pill) : null}
      pillIconSizeClass="size-3"
      createdRel={createdRel}
      isCompleted={isCompleted}
      durationMs={durationMs}
      formatDurationMs={props.formatDurationMs}
      statusLabel={props.statusLabel(uiStatus)}
      statusIcon={statusSpec}
    />
  )

  const middleCollapsed = (
    <span className="inline-flex min-w-0 items-center gap-3">
      {r.pill ? (
        <span className="inline-flex min-w-0 items-center gap-1">
          <Tag className="size-3.5" aria-hidden="true" />
          <span className="truncate">{r.pill}</span>
        </span>
      ) : null}
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

  const ctl = runControlAvailability({ canonicalStatus: canonical, cancelRequestedAtIso: r.cancelRequestedAt ?? null })
  const canCancel = !!props.actions?.cancel && ctl.canCancel
  const canForceStop = !!props.actions?.forceStop && ctl.showForceStop
  const showCopy = !!props.actions?.copyId || !!props.actions?.copyLink
  const showControls = canCancel || canForceStop

  const actions = (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("common.actions")}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          {canCancel ? (
            <DropdownMenuItem
              variant="destructive"
              onSelect={(e) => {
                void props.actions?.cancel?.()
              }}
            >
              <Ban className="size-4" />
              {t("runs.cancelRunAction")}
            </DropdownMenuItem>
          ) : null}
          {canForceStop ? (
            <DropdownMenuItem
              variant="destructive"
              onSelect={(e) => {
                void props.actions?.forceStop?.()
              }}
            >
              <Ban className="size-4" />
              {t("runs.forceStopAction")}
            </DropdownMenuItem>
          ) : null}

          {showControls && showCopy ? <DropdownMenuSeparator /> : null}
          {props.actions?.copyId ? (
            <DropdownMenuItem
              onSelect={(e) => {
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
