"use client"

import * as React from "react"
import Link from "next/link"
import {
  Activity,
  AlertCircle,
  Building2,
  Calendar,
  Clock3,
  Copy,
  Hash,
  Layers,
  ListChecks,
  MoreHorizontal,
  Play,
  Server,
  SquareArrowOutUpRight,
  User,
  WorkflowIcon,
} from "lucide-react"

import type { Locale } from "@/lib/shared/i18n/constants"
import { calcDurationMs, formatRelativeTimeFromNow, formatDurationMs } from "@/lib/shared/format/time"
import { operationStatusUiSpec } from "@/lib/shared/operation-status"
import { cn } from "@/lib/utils"

import { CommonListItem } from "@/components/common/common-list-item"
import { CopyableIdBadge } from "@/components/common/copyable-id-badge"
import { InlineItemRow, type InlineItemRowItem } from "@/components/common/inline-item-row"
import { ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { Button } from "@/components/ui/button"
import { useI18nOptional } from "@/components/i18n-provider"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type OperationsListItemModel = {
  id: string
  status: string
  action: string
  source?: string | null
  targetType?: string | null
  targetId?: string | null
  scope?: string | null
  audit?: { actor: string | null; tenantId: string | null; requestId: string | null } | null
  responseStatus?: number | null
  errorCode?: string | null
  errorMessage?: string | null
  createdAt: string
  completedAt?: string | null
  progress?: {
    current: number
    total: number | null
    messageKey: string | null
    messageParams: Record<string, string | number> | null
  } | null
}

function OperationsTimingRow(props: {
  className?: string
  pill: string | null
  pillIconSizeClass: string
  createdRel: string
  isCompleted: boolean
  durationMs: number | null
  statusLabel: string
  statusIcon: {
    Icon: React.ComponentType<{ className?: string }> | null
    iconClassName?: string
    varsClassName: string
    textClassName: string
  }
  progressText: string | null
}) {
  return (
    <div className={props.className}>
      <span className="inline-flex items-center gap-1">
        <Calendar className="size-3.5" aria-hidden="true" />
        {props.createdRel}
      </span>
      {props.isCompleted ? (
        <span className="inline-flex items-center gap-1">
          <Clock3 className="size-3.5" aria-hidden="true" />
          {props.durationMs == null ? "—" : formatDurationMs(props.durationMs)}
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
      {props.pill ? (
        <span className="inline-flex items-center gap-1">
          <Activity className={props.pillIconSizeClass} aria-hidden="true" />
          {props.pill}
        </span>
      ) : null}
    </div>
  )
}

function progressText(
  p: OperationsListItemModel["progress"],
  t?: (key: string, params?: Record<string, string | number>) => string,
) {
  if (!p) return null
  const messageKey = typeof p.messageKey === "string" && p.messageKey.trim() ? p.messageKey.trim() : null
  const msg = messageKey ? (t ? t(messageKey, p.messageParams ?? undefined) : messageKey) : null
  const total = typeof p.total === "number" && Number.isFinite(p.total) ? p.total : null
  const cur = typeof p.current === "number" && Number.isFinite(p.current) ? p.current : null
  const frac = total != null && cur != null ? `${Math.max(0, cur)}/${Math.max(0, total)}` : null
  if (msg && frac) return `${msg} (${frac})`
  if (msg) return msg
  if (frac) return frac
  return null
}

type OperationsListItemActions = {
  copyId?: () => void | Promise<void>
}

export function OperationsCommonListItem(props: {
  locale: Locale
  model: OperationsListItemModel
  href: string
  statusLabel: (s: string) => string
  actions?: OperationsListItemActions
}) {
  const i18n = useI18nOptional()
  const t = i18n?.t
  const { model: op } = props
  const statusSpec = operationStatusUiSpec(op.status)
  const createdRel = formatRelativeTimeFromNow(op.createdAt, { locale: props.locale })
  const isCompleted = !!op.completedAt
  const durationMs = calcDurationMs(op.createdAt, op.completedAt ?? null)
  const ptxt = progressText(op.progress ?? null, t)

  const responseStatus =
    typeof op.responseStatus === "number" && Number.isFinite(op.responseStatus) ? Math.floor(op.responseStatus) : null
  const errorCode = op.errorCode ? String(op.errorCode) : null
  const errorMessage = op.errorMessage ? String(op.errorMessage) : null
  const showErrorBadge = statusSpec.status === "FAILED" && (errorCode || responseStatus != null)
  const displayErrorCode = errorCode || (responseStatus != null ? `HTTP_${responseStatus}` : "UNKNOWN")

  const targetId = op.targetId ? String(op.targetId) : null
  const targetType = op.targetType ? String(op.targetType) : null
  const requestId = op.audit?.requestId ? String(op.audit.requestId) : null
  const actor = op.audit?.actor ? String(op.audit.actor) : null
  const tenantId = op.audit?.tenantId ? String(op.audit.tenantId) : null
  const source = op.source ? String(op.source) : null

  const metaItems = React.useMemo((): InlineItemRowItem[] => {
    const items: InlineItemRowItem[] = []
    if (actor) items.push({ key: "actor", title: "Actor", Icon: User, text: <span className="truncate">{actor}</span> })
    if (tenantId)
      items.push({
        key: "tenant",
        title: "Tenant",
        Icon: Building2,
        text: <span className="truncate">{tenantId}</span>,
      })
    if (source)
      items.push({
        key: "source",
        title: "Source",
        Icon: Activity,
        text: <span className="truncate font-mono text-[11px] text-muted-foreground">{source}</span>,
      })
    if (responseStatus != null) {
      items.push({
        key: "http",
        title: "HTTP",
        Icon: Server,
        text: <span className={cn("truncate font-mono text-[11px] text-muted-foreground")}>HTTP {responseStatus}</span>,
      })
    }
    if (showErrorBadge) {
      items.push({
        key: "error",
        title: "Error",
        Icon: AlertCircle,
        iconClassName: "text-destructive",
        text: <span className="truncate font-mono text-[11px] text-destructive">{String(displayErrorCode)}</span>,
        tooltip: errorMessage || undefined,
      })
    }
    return items
  }, [actor, displayErrorCode, errorMessage, responseStatus, showErrorBadge, source, tenantId])

  const targetIcon = (() => {
    if (!targetType) return Activity
    if (targetType === "run") return Play
    if (targetType === "job") return ListChecks
    if (targetType === "schedule") return Clock3
    if (targetType === "workflow") return WorkflowIcon
    if (targetType === "batch") return Layers
    return Activity
  })()

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
              <span className="block truncate font-mono">{op.action || "—"}</span>
            </ItemTitle>
          </div>
        </div>
      </div>

      <ItemDescription className="mt-1 pl-7 line-clamp-1">
        <span className="inline-flex flex-wrap items-center gap-2">
          <CopyableIdBadge id={op.id} Icon={Activity} />
          {targetId ? <CopyableIdBadge id={targetId} Icon={targetIcon} /> : null}
          {requestId ? <CopyableIdBadge id={requestId} label="req" Icon={Hash} /> : null}
        </span>
      </ItemDescription>

      {/* Meta (mobile + desktop) */}
      {metaItems.length ? (
        <>
          <InlineItemRow
            className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-muted-foreground md:hidden"
            items={metaItems}
          />
          <InlineItemRow
            className="mt-1 hidden flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-muted-foreground md:flex"
            items={metaItems}
          />
        </>
      ) : null}

      {/* Mobile timing/status */}
      <OperationsTimingRow
        className="mt-1 flex flex-wrap items-center gap-2 pl-7 text-xs text-muted-foreground md:hidden"
        pill={op.scope ? String(op.scope) : null}
        pillIconSizeClass="size-3.5"
        createdRel={createdRel}
        isCompleted={isCompleted}
        durationMs={durationMs}
        statusLabel={props.statusLabel(op.status)}
        statusIcon={statusSpec}
        progressText={ptxt}
      />
    </ItemContent>
  )

  const middleColumn = (
    <OperationsTimingRow
      className="flex flex-col items-start gap-1 pt-0.5 text-xs text-muted-foreground"
      pill={op.scope ? String(op.scope) : null}
      pillIconSizeClass="size-3"
      createdRel={createdRel}
      isCompleted={isCompleted}
      durationMs={durationMs}
      statusLabel={props.statusLabel(op.status)}
      statusIcon={statusSpec}
      progressText={ptxt}
    />
  )

  const actions = (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t ? t("common.actions") : "Actions"}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          {props.actions?.copyId ? (
            <DropdownMenuItem
              onSelect={(e) => {
                void props.actions?.copyId?.()
              }}
            >
              <Copy className="size-4" />
              {t ? t("operations.list.actions.copyOperationIdAction") : "Copy operation ID"}
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
        { key: "middle", content: middleColumn, minWidthPx: 200, collapsePriority: 50 },
      ]}
      actions={actions}
    />
  )
}
