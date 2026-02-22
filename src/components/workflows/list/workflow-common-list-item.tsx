"use client"

import Link from "next/link"
import * as React from "react"
import {
  AlertCircle,
  Calendar,
  Copy,
  KeyRound,
  Link2,
  ListTree,
  MoreHorizontal,
  Package,
  Play,
  Tag,
  Upload,
  WorkflowIcon,
} from "lucide-react"

import type { Locale } from "@/lib/shared/i18n/constants"
import { formatRelativeTimeFromNow } from "@/lib/shared/format/time"
import { apiFetchJson } from "@/lib/shared/http/api"
import { normalizeFilenameStem } from "@/lib/shared/filename"
import { tApiError } from "@/lib/shared/i18n/error"

import { CommonListItem } from "@/components/common/common-list-item"
import { InlineItemRow, type InlineItemRowItem } from "@/components/common/inline-item-row"
import { CopyableIdBadge } from "@/components/common/copyable-id-badge"
import { StandardActionDialog } from "@/components/common/standard-action-dialog"
import { useI18n } from "@/components/i18n-provider"
import { GradientBotIcon } from "@/components/icons/GradientBotIcon"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/lib/client/toast"
import { downloadBlob } from "@/lib/client/download"
import { resolveWorkflowDepsDisplayError } from "@/lib/shared/error-display/adapters/workflow-deps"
import { cn } from "@/lib/utils"

export type WorkflowListItemModel = {
  id: string
  title: string
  description: string | null
  depsStatus: string
  depsErrorCode?: string | null
  depsErrorMessage?: string | null
  depsErrorMetaJson?: string | null
  depsErrorAt?: string | null
  npmDepsCount: number
  envCount?: number | null
  hasInputSpec?: boolean
  latestVersionNumber?: number | null
  lastRun?: {
    id: string
    status: string
    createdAt: string
    startedAt: string | null
    finishedAt: string | null
    workflowVersionNumber: number | null
  } | null
  stepCount: number
  runCount: number
  runningRunCount: number
  updatedAt?: string | null
}

type WorkflowListItemActions = {
  copyId?: () => void | Promise<void>
  copyLink?: () => void | Promise<void>
}

export function WorkflowCommonListItem(props: {
  locale: Locale
  model: WorkflowListItemModel
  href: string
  actions?: WorkflowListItemActions
}) {
  const { t } = useI18n()
  const { model: w } = props
  const [exportOpen, setExportOpen] = React.useState(false)
  const [includeEnv, setIncludeEnv] = React.useState(false)
  const [exportPending, setExportPending] = React.useState(false)
  const updatedRel =
    typeof w.updatedAt === "string" && w.updatedAt.trim()
      ? formatRelativeTimeFromNow(w.updatedAt, { locale: props.locale })
      : "—"

  const envCount = typeof w.envCount === "number" && Number.isFinite(w.envCount) && w.envCount >= 0 ? w.envCount : null
  const showVersionPill =
    typeof w.latestVersionNumber === "number" &&
    Number.isFinite(w.latestVersionNumber) &&
    (w.latestVersionNumber ?? 0) > 0
  const lastRun = w.lastRun ?? null
  const lastRunCreatedRel = lastRun ? formatRelativeTimeFromNow(lastRun.createdAt, { locale: props.locale }) : "—"

  const descriptionText = React.useMemo(() => {
    const raw = typeof w.description === "string" ? w.description : ""
    return raw.replace(/\\s+/g, " ").trim()
  }, [w.description])

  const depsFailure = React.useMemo(() => {
    return resolveWorkflowDepsDisplayError({
      depsErrorCode: w.depsErrorCode ?? null,
      depsErrorMessage: w.depsErrorMessage ?? null,
      depsErrorMetaJson: w.depsErrorMetaJson ?? null,
    })
  }, [w.depsErrorCode, w.depsErrorMessage, w.depsErrorMetaJson])

  const inlineMetaItems = React.useMemo((): InlineItemRowItem[] => {
    const items: InlineItemRowItem[] = []

    if (showVersionPill) {
      items.push({
        key: "version",
        title: t("workflows.workflowVersion"),
        Icon: Tag,
        text: `v${w.latestVersionNumber}`,
      })
    }

    items.push({
      key: "deps",
      title: t("workflows.npmDependencies"),
      Icon: Package,
      text: w.npmDepsCount,
    })

    if (envCount !== null) {
      items.push({
        key: "env",
        title: t("workflows.env.title"),
        Icon: KeyRound,
        text: envCount,
      })
    }

    items.push({
      key: "lastRun",
      title: t("workflows.lastRun"),
      Icon: Calendar,
      text: lastRun ? lastRunCreatedRel : t("workflows.noRuns"),
    })

    if (
      w.depsStatus === "FAILED" &&
      (depsFailure.displayCode || depsFailure.wrapperCode || depsFailure.wrapperMessage)
    ) {
      const displayCode = depsFailure.displayCode ?? depsFailure.wrapperCode ?? "UNKNOWN"
      const tooltip =
        depsFailure.wrapperCode && depsFailure.wrapperCode !== displayCode
          ? `${depsFailure.wrapperCode}${depsFailure.wrapperMessage ? `: ${depsFailure.wrapperMessage}` : ""}`
          : (depsFailure.wrapperMessage ?? depsFailure.wrapperCode ?? undefined)
      items.push({
        key: "error",
        title: t("common.errorLabel"),
        Icon: AlertCircle,
        text: <span className="truncate font-mono text-[11px] text-destructive">{String(displayCode)}</span>,
        iconClassName: "text-destructive",
        tooltip,
      })
    }

    return items
  }, [
    depsFailure.displayCode,
    depsFailure.wrapperCode,
    depsFailure.wrapperMessage,
    envCount,
    lastRun,
    lastRunCreatedRel,
    showVersionPill,
    t,
    w.depsStatus,
    w.latestVersionNumber,
    w.npmDepsCount,
  ])

  const countItems: InlineItemRowItem[] = [
    { key: "steps", title: t("common.steps"), Icon: ListTree, text: w.stepCount },
    { key: "runs", title: t("workflows.runs"), Icon: Play, text: w.runCount },
    {
      key: "running",
      title: t("workflows.running"),
      Icon: Spinner,
      iconClassName: "opacity-70",
      text: w.runningRunCount,
    },
  ]

  async function doExport() {
    if (exportPending) return
    setExportPending(true)
    try {
      type WorkflowExportResponse = { workflow?: { id?: string; name?: string } } & Record<string, unknown>
      const json = await apiFetchJson<WorkflowExportResponse>(
        `/api/workflows/${w.id}/export?includeEnv=${includeEnv ? "1" : "0"}`,
        {
          cache: "no-store",
        },
      )
      const wfId = String(json?.workflow?.id ?? w.id).toUpperCase()
      const wfName = String(json?.workflow?.name ?? w.title ?? "workflow")
      const fileName = `${wfId}-${normalizeFilenameStem(wfName, { fallback: wfId })}.json`
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" })
      downloadBlob({ blob, filename: fileName })
      setExportOpen(false)
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
    } finally {
      setExportPending(false)
    }
  }

  const leftColumn = (
    <ItemContent className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0">
          <WorkflowIcon aria-hidden="true" className="size-4.5 shrink-0 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <ItemTitle className="w-full min-w-0 text-base leading-snug">
              <span className="block truncate">{w.title}</span>
            </ItemTitle>
          </div>
        </div>
      </div>

      <ItemDescription className="mt-1 pl-7 line-clamp-1">
        <span className="inline-flex flex-wrap items-center gap-2">
          <CopyableIdBadge id={w.id} Icon={WorkflowIcon} />
          {descriptionText ? <span className="min-w-0">{descriptionText}</span> : null}
        </span>
      </ItemDescription>

      <InlineItemRow
        className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-muted-foreground"
        items={inlineMetaItems}
      />

      <InlineItemRow
        className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-muted-foreground md:hidden"
        items={countItems}
      />
      <div className="mt-1 flex flex-wrap items-center gap-2 pl-7 text-xs text-muted-foreground md:hidden">
        <span className="inline-flex items-center gap-1">
          <Calendar className="size-3.5" aria-hidden="true" />
          {t("workflows.updatedAt")}: {updatedRel}
        </span>
      </div>
    </ItemContent>
  )

  const middleColumn = (
    <div className="flex flex-col items-start gap-1 pt-0.5 text-xs text-muted-foreground">
      {countItems.map((it) => {
        const Icon = it.Icon
        if (!Icon) return null
        const valueText = typeof it.text === "number" || typeof it.text === "string" ? String(it.text) : null
        return (
          <span key={it.key} className="inline-flex min-w-0 items-center gap-1.5">
            <Icon className={cn("size-3.5 shrink-0", it.iconClassName)} aria-hidden={true} />
            <span className="min-w-0 truncate">
              {it.title}: {valueText ?? "—"}
            </span>
          </span>
        )
      })}
    </div>
  )
  const middleCollapsed = (
    <span className="inline-flex min-w-0 items-center gap-3">
      <span className="inline-flex min-w-0 items-center gap-1">
        <ListTree className="size-3.5" aria-hidden="true" />
        <span className="truncate" title={t("common.steps")}>
          {w.stepCount}
        </span>
      </span>
      <span className="inline-flex min-w-0 items-center gap-1">
        <Play className="size-3.5" aria-hidden="true" />
        <span className="truncate" title={t("workflows.runs")}>
          {w.runCount}
        </span>
      </span>
      <span className="inline-flex min-w-0 items-center gap-1">
        <Spinner className="size-3.5 opacity-70" aria-hidden="true" />
        <span className="truncate" title={t("workflows.running")}>
          {w.runningRunCount}
        </span>
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
          <DropdownMenuItem asChild>
            <Link href={`/workflows/${w.id}/versions`} className="cursor-pointer">
              <Tag className="size-4" />
              {t("workflows.versions.title")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={`/agent?workflowId=${encodeURIComponent(w.id)}`} className="cursor-pointer">
              <GradientBotIcon className="size-4 shrink-0" />
              <span className="bg-gradient-to-r from-fuchsia-500 via-violet-500 to-cyan-500 bg-clip-text text-transparent">
                {t("workflows.aiOrchestrateAction")}
              </span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              setExportOpen(true)
            }}
          >
            <Upload className="size-4" />
            {t("common.exportAction")}
          </DropdownMenuItem>
          {props.actions?.copyId || props.actions?.copyLink ? <DropdownMenuSeparator /> : null}
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
    <>
      <StandardActionDialog
        open={exportOpen}
        onOpenChange={(o) => !exportPending && setExportOpen(o)}
        title={t("workflows.importExport.export.titleWorkflow")}
        titleIcon={<Upload className="h-4 w-4" aria-hidden="true" />}
        description={
          <div className="space-y-3">
            <Alert variant={includeEnv ? "destructive" : "default"}>
              <AlertTitle className="line-clamp-none">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`wf-export-include-env-${w.id}`}
                    checked={includeEnv}
                    onCheckedChange={(v) => setIncludeEnv(v === true)}
                  />
                  <Label
                    htmlFor={`wf-export-include-env-${w.id}`}
                    className="cursor-pointer select-none text-sm font-medium"
                  >
                    {t("workflows.importExport.export.includeEnvTitle")}
                  </Label>
                </div>
              </AlertTitle>
              <AlertDescription>
                {includeEnv ? (
                  <p>{t("workflows.importExport.export.includeEnvDescriptionChecked")}</p>
                ) : (
                  <p>{t("workflows.importExport.export.includeEnvDescriptionUnchecked")}</p>
                )}
              </AlertDescription>
            </Alert>
          </div>
        }
        pending={exportPending}
        actions={[
          { key: "cancel", kind: "cancel", disabled: exportPending, onClick: () => setExportOpen(false) },
          {
            key: "export",
            label: exportPending
              ? t("workflows.importExport.export.exporting")
              : t("workflows.importExport.export.exportAction"),
            icon: exportPending ? (
              <Spinner className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Upload className="h-4 w-4" aria-hidden="true" />
            ),
            disabled: exportPending,
            onClick: () => void doExport(),
          },
        ]}
      />

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
    </>
  )
}
