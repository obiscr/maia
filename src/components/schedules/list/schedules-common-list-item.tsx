"use client"

import {
  Calendar,
  Clock,
  Clock3,
  Copy,
  Link2,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Play,
  Power,
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
import { formatRelativeTimeFromNow } from "@/lib/shared/format/time"
import { scheduleStatusUiSpec } from "@/lib/shared/schedule-status"
import { scheduleToggleSpec } from "@/lib/shared/schedule-control"
import { cn } from "@/lib/utils"

export type SchedulesListItemModel = {
  id: string
  title: string
  enabled: boolean
  workflowId?: string | null
  lastJobId?: string | null
  lastRunId?: string | null
  createdAt: string
  kind: string
  cron?: string | null
  timezone?: string | null
  intervalMs?: number | null
  nextRunAt?: string | null
}

type SchedulesListItemActions = {
  copyId?: () => void | Promise<void>
  toggleEnabled?: (enabled: boolean) => void | Promise<void>
  runNow?: () => void | Promise<void>
  edit?: () => void | Promise<void>
  copyLink?: () => void | Promise<void>
}

export function SchedulesCommonListItem(props: {
  locale: Locale
  model: SchedulesListItemModel
  href: string
  statusLabel: (enabled: boolean) => string
  actions?: SchedulesListItemActions
}) {
  const { t } = useI18n()
  const { model: s } = props
  const toggleSpec = React.useMemo(() => scheduleToggleSpec(s.enabled), [s.enabled])
  const statusUi = scheduleStatusUiSpec(s.enabled ? "ENABLED" : "DISABLED")
  const createdRel = formatRelativeTimeFromNow(s.createdAt, { locale: props.locale })
  const nextRel = s.nextRunAt ? formatRelativeTimeFromNow(s.nextRunAt, { locale: props.locale }) : "—"

  const scheduleText =
    s.kind === "CRON"
      ? `${t("schedules.cron")}: ${String(s.cron ?? "").trim() || "—"} (${String(s.timezone ?? "UTC")})`
      : `${t("schedules.intervalMs")}: ${typeof s.intervalMs === "number" ? String(s.intervalMs) : "—"}`

  const specItems = React.useMemo((): InlineItemRowItem[] => {
    const Icon = s.kind === "CRON" ? Calendar : Timer
    return [{ key: "spec", Icon, text: scheduleText, title: scheduleText }]
  }, [s.kind, scheduleText])

  const leftColumn = (
    <ItemContent className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        {statusUi.Icon ? (
          <span className="shrink-0">
            <statusUi.Icon
              aria-hidden="true"
              className={cn(
                "size-4.5 shrink-0",
                statusUi.iconClassName,
                statusUi.varsClassName,
                statusUi.textClassName,
              )}
            />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <ItemTitle className="w-full min-w-0 text-base leading-snug">
              <span className="block truncate">{s.title}</span>
            </ItemTitle>
          </div>
        </div>
      </div>

      <ItemDescription className="mt-1 pl-7 line-clamp-1">
        <span className="inline-flex flex-wrap items-center gap-2">
          <CopyableIdBadge id={s.id} Icon={Clock} />
          {s.lastJobId ? <CopyableIdBadge id={s.lastJobId} Icon={ListChecks} /> : null}
          {s.lastRunId ? <CopyableIdBadge id={s.lastRunId} Icon={Play} /> : null}
          {s.workflowId ? <CopyableIdBadge id={s.workflowId} Icon={WorkflowIcon} /> : null}
        </span>
      </ItemDescription>

      <InlineItemRow
        className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-muted-foreground"
        items={specItems}
      />

      <div className="mt-1 flex flex-wrap items-center gap-2 pl-7 text-xs text-muted-foreground md:hidden">
        <span className="inline-flex items-center gap-1">
          <Calendar className="size-3.5" aria-hidden="true" />
          {createdRel}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock3 className="size-3.5" aria-hidden="true" />
          {nextRel}
        </span>
      </div>
    </ItemContent>
  )

  const middleColumn = (
    <div className="flex flex-col items-start gap-1 pt-0.5 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Calendar className="size-3.5" aria-hidden="true" />
        {createdRel}
      </span>
      <span className="inline-flex items-center gap-1">
        <Clock3 className="size-3.5" aria-hidden="true" />
        {nextRel}
      </span>
    </div>
  )

  const middleCollapsed = (
    <span className="inline-flex min-w-0 items-center gap-3">
      <span className="inline-flex min-w-0 items-center gap-1">
        <Calendar className="size-3.5" aria-hidden="true" />
        <span className="truncate">{createdRel}</span>
      </span>
      <span className="inline-flex min-w-0 items-center gap-1">
        <Clock3 className="size-3.5" aria-hidden="true" />
        <span className="truncate">{nextRel}</span>
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
          {props.actions?.toggleEnabled ? (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                void props.actions?.toggleEnabled?.(toggleSpec.nextEnabled)
              }}
            >
              <Power className="size-4" />
              {t(toggleSpec.labelKey)}
            </DropdownMenuItem>
          ) : null}
          {props.actions?.runNow ? (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                void props.actions?.runNow?.()
              }}
            >
              <Play className="size-4" />
              {t("schedules.runNowAction")}
            </DropdownMenuItem>
          ) : null}
          {props.actions?.edit ? (
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                void props.actions?.edit?.()
              }}
            >
              <Pencil className="size-4" />
              {t("common.editAction")}
            </DropdownMenuItem>
          ) : null}
          {props.actions?.toggleEnabled || props.actions?.runNow || props.actions?.edit
            ? (props.actions?.copyId || props.actions?.copyLink ? <DropdownMenuSeparator /> : null)
            : null}
          {props.actions?.copyId || props.actions?.copyLink ? (
            <>
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
            </>
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
