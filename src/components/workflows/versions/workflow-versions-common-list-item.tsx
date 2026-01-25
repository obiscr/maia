"use client"

import * as React from "react"
import Link from "next/link"
import { Calendar, Hash, KeyRound, ListTree, MoreHorizontal, Package, RotateCcw, Tag, Upload } from "lucide-react"

import type { Locale } from "@/lib/shared/i18n/constants"
import { formatAbsoluteTimeTitle, formatRelativeTimeFromNow } from "@/lib/shared/format/time"
import { InlineItemRow, type InlineItemRowItem } from "@/components/common/inline-item-row"
import { ShortId } from "@/components/common/short-id"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useI18n } from "@/components/i18n-provider"
import { useTimezone } from "@/components/timezone-provider"
import { StandardActionDialog } from "@/components/common/standard-action-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Label } from "@/components/ui/label"
import { apiFetchJson } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"
import { downloadBlob } from "@/lib/client/download"
import { tApiError } from "@/lib/shared/i18n/error"
import { normalizeFilenameStem } from "@/lib/shared/filename"
import { CommonListItem } from "@/components/common/common-list-item"
import { ItemContent, ItemTitle } from "@/components/ui/item"

export type WorkflowVersionsListItemModel = {
  id: string
  version: number
  createdAt: string
  description: string | null
  stepsCount: number
  depsHash: string | null
  depsPackagesCount: number
  envVarsCount: number
}

export function WorkflowVersionsCommonListItem(props: {
  locale: Locale
  model: WorkflowVersionsListItemModel
  workflowId: string
  href: string
  onRestore: (version: number) => void | Promise<void>
}) {
  const { t } = useI18n()
  const { effectiveTimezone } = useTimezone()
  const { model: v } = props
  const [exportOpen, setExportOpen] = React.useState(false)
  const [includeEnv, setIncludeEnv] = React.useState(false)
  const [exportPending, setExportPending] = React.useState(false)

  const createdIso = v.createdAt ? String(v.createdAt) : null
  const createdRel = createdIso ? formatRelativeTimeFromNow(createdIso, { locale: props.locale }) : "—"

  const statsItems = React.useMemo((): InlineItemRowItem[] => {
    return [
      {
        key: "steps",
        title: t("workflows.versions.stepsCount", { n: v.stepsCount }),
        Icon: ListTree,
        text: t("workflows.versions.stepsCount", { n: v.stepsCount }),
      },
      {
        key: "deps",
        title: t("workflows.dependencies"),
        Icon: Package,
        text: t("workflows.versions.depsCount", { n: v.depsPackagesCount }),
      },
      {
        key: "env",
        title: t("workflows.env.title"),
        Icon: KeyRound,
        text: t("workflows.versions.envCount", { n: v.envVarsCount }),
      },
    ]
  }, [t, v.depsPackagesCount, v.envVarsCount, v.stepsCount])

  async function doExport() {
    if (exportPending) return
    setExportPending(true)
    try {
      const ver = String(v.version)
      type WorkflowVersionExportResponse = { workflow?: { id?: string; name?: string } } & Record<string, unknown>
      const json = await apiFetchJson<WorkflowVersionExportResponse>(
        `/api/workflows/${props.workflowId}/versions/${encodeURIComponent(ver)}/export?includeEnv=${includeEnv ? "1" : "0"}`,
        { cache: "no-store" },
      )
      const outId = String(json?.workflow?.id ?? props.workflowId).toUpperCase()
      const outName = String(json?.workflow?.name ?? "workflow")
      const fileName = `${outId}-v${ver}-${normalizeFilenameStem(outName, { fallback: outId })}.json`
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
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <ItemTitle className="w-full min-w-0 text-base leading-snug">
          <span className="inline-flex min-w-0 items-center gap-1 font-mono font-semibold">
            <Tag aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">v{String(v.version)}</span>
          </span>
        </ItemTitle>
        {v.depsHash ? (
          <Badge variant="outline" className="h-5 px-2 font-mono text-[11px]">
            <span className="inline-flex min-w-0 items-center gap-1">
              <Hash aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span>{t("workflows.versions.depsHashLabel")}:</span>
              <ShortId id={v.depsHash} head={10} tail={0} minLength={11} />
            </span>
          </Badge>
        ) : null}
      </div>

      {v.description ? (
        <div className="mt-1 min-w-0 text-sm text-foreground/90 line-clamp-2">{v.description}</div>
      ) : null}

      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <InlineItemRow className="flex flex-wrap items-center gap-x-3 gap-y-1" items={statsItems} />
        <span
          className="inline-flex items-center gap-1"
          title={formatAbsoluteTimeTitle(createdIso, { locale: props.locale, timeZone: effectiveTimezone })}
        >
          <Calendar className="size-3.5" aria-hidden="true" />
          {createdRel}
        </span>
      </div>
    </ItemContent>
  )

  const actions = (
    <div>
      {/* Mobile */}
      <div className="sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("common.actions")}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                void props.onRestore(v.version)
              }}
            >
              <RotateCcw className="size-4" />
              {t("common.createActionVersionFromSnapshotAction")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                setExportOpen(true)
              }}
            >
              <Upload className="size-4" />
              {t("common.exportAction")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Desktop/tablet */}
      <div className="hidden items-center gap-2 sm:flex">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void props.onRestore(v.version)
          }}
        >
          <RotateCcw className="size-4" />
          {t("common.createActionVersionFromSnapshotAction")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("common.actions")}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                setExportOpen(true)
              }}
            >
              <Upload className="size-4" />
              {t("common.exportAction")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )

  return (
    <>
      <StandardActionDialog
        open={exportOpen}
        onOpenChange={(o) => !exportPending && setExportOpen(o)}
        title={t("workflows.importExport.export.titleVersion")}
        titleIcon={<Upload className="h-4 w-4" aria-hidden="true" />}
        description={
          <div className="space-y-3">
            <Alert variant={includeEnv ? "destructive" : "default"}>
              <AlertTitle className="line-clamp-none">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`wf-export-include-env-${props.workflowId}-v${String(v.version)}`}
                    checked={includeEnv}
                    onCheckedChange={(v) => setIncludeEnv(v === true)}
                  />
                  <Label
                    htmlFor={`wf-export-include-env-${props.workflowId}-v${String(v.version)}`}
                    className="cursor-pointer select-none text-sm font-medium"
                  >
                    {t("workflows.importExport.export.includeEnvTitle")}
                  </Label>
                </div>
              </AlertTitle>
              <AlertDescription>
                <p>
                  {includeEnv
                    ? t("workflows.importExport.export.includeEnvDescriptionChecked")
                    : t("workflows.importExport.export.includeEnvDescriptionUnchecked")}
                </p>
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
        columns={[{ key: "left", content: leftColumn, showOnMobile: true }]}
        actions={actions}
      />
    </>
  )
}
