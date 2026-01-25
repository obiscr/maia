"use client"

import { useI18n } from "@/components/i18n-provider"
import { Package } from "lucide-react"

import { WorkflowDepsManagerSheet } from "@/components/workflows/editor/workflow-deps-manager-sheet"
import { type DepsPreviewRow } from "@/components/workflows/editor/workflow-deps-preview-table"
import { WorkflowSettingsConfigCard } from "@/components/workflows/editor/workflow-settings-config-card"
import { InlineItemRow } from "@/components/common/inline-item-row"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { toUiWorkflowDepsStatus, workflowDepsStatusUiSpec } from "@/lib/shared/workflow-deps-status"

type DepsRow = { id: string; name: string; version: string }

function parseDepsJsonToRows(depsJson: string): { rows: DepsRow[] } {
  try {
    const obj = JSON.parse(depsJson || "{}")
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { rows: [] }

    const root = obj as Record<string, unknown>
    const out = new Map<string, string>()

    const ingest = (val: unknown) => {
      if (!val || typeof val !== "object" || Array.isArray(val)) return
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (typeof v === "string") out.set(String(k), v)
      }
    }

    const isSectionObject = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v)
    const hasSections =
      isSectionObject(root.dependencies) ||
      isSectionObject(root.devDependencies) ||
      isSectionObject(root.optionalDependencies) ||
      isSectionObject(root.peerDependencies)
    if (hasSections) {
      if (isSectionObject(root.dependencies)) ingest(root.dependencies)
      if (isSectionObject(root.devDependencies)) ingest(root.devDependencies)
      if (isSectionObject(root.optionalDependencies)) ingest(root.optionalDependencies)
      if (isSectionObject(root.peerDependencies)) ingest(root.peerDependencies)
    } else ingest(root)

    const rows = [...out.entries()]
      .map(([name, version]) => ({ id: `dep:${name}`, name, version }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return { rows }
  } catch {
    // If draft JSON is invalid, we still consider it "not dirty" here;
    // depsErr will drive the status UI (FAILED) instead.
    return { rows: [] }
  }
}

function rowsToDepsJson(rows: DepsRow[]) {
  const obj: Record<string, string> = {}
  for (const r of rows) {
    const name = r.name.trim()
    const version = r.version.trim()
    if (!name || !version) continue
    obj[name] = version
  }
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)))
  return JSON.stringify(sorted, null, 2)
}

function normalizeDepsJsonString(s: string) {
  const parsed = parseDepsJsonToRows(s || "{}")
  return rowsToDepsJson(parsed.rows)
}

export function WorkflowDepsSection(props: {
  workflowId: string
  depsDraftJson: string
  onDepsDraftJsonChange: (v: string) => void
  depsJson: string
  depsErr: string | null
  onDepsErrChange: (e: string | null) => void
  depsStatus: string
  depsFailureBadge?: { code: string; tooltip?: string } | null
  depsSavePending: boolean
  depsInstallPending?: boolean
  onSaveDepsDraft: (opts?: { silentToast?: boolean }) => void | Promise<void>
  depsInstallErr: unknown
  onInstallDeps: () => void | Promise<void>
  activeTab: "deps" | "logs"
  onActiveTabChange: (tab: "deps" | "logs") => void
  loadLogs: () => Promise<{ logs: Array<{ id: string; level: string; createdAt: string; message: string }> }>
  sheetOpen: boolean
  onSheetOpenChange: (open: boolean) => void
  sheetContentRef: React.RefObject<HTMLDivElement | null>
  previewRows: DepsPreviewRow[]
  previewEmptyText?: string
}) {
  const { t } = useI18n()
  const count = props.previewRows.length
  const configured = count > 0
  const depsFailureBadge = props.depsFailureBadge ?? null
  const dirty = normalizeDepsJsonString(props.depsDraftJson) !== normalizeDepsJsonString(props.depsJson)
  const depsUiStatus = toUiWorkflowDepsStatus(props.depsStatus, { configured, dirty })
  // UX parity with the deps sheet footer:
  // - The sheet shows an optimistic "INSTALLING" state immediately on click.
  // - When deps are dirty, the sheet first saves the draft (depsSavePending) and only then triggers install.
  //   During this short window, wf.depsStatus is still stale, so we mirror the footer by treating it as INSTALLING.
  const depsStatusOverride = props.depsErr
    ? "FAILED"
    : props.depsInstallPending
      ? "INSTALLING"
      : props.depsSavePending && dirty
        ? "INSTALLING"
        : (depsUiStatus as string)
  const depsUi = workflowDepsStatusUiSpec(depsStatusOverride)
  let depsStatusLabel: string
  switch (depsUi.status) {
    case "NOT_CONFIGURED":
      depsStatusLabel = t("common.notConfigured")
      break
    case "READY":
      depsStatusLabel = t("workflows.deps.status.ready")
      break
    case "INSTALLING":
      depsStatusLabel = t("workflows.deps.status.installing")
      break
    case "FAILED":
      depsStatusLabel = t("common.statusValues.failed")
      break
    case "IDLE":
      depsStatusLabel = t("workflows.deps.status.install")
      break
    default:
      depsStatusLabel = depsUi.status
      break
  }

  const showDraftErrorTooltip = !!props.depsErr
  const showDepsFailureBadgeIcon = depsUi.status === "FAILED" && !!depsFailureBadge?.code
  let depsFailureBadgeTooltipNode: React.ReactNode = null
  if (depsFailureBadge?.tooltip) {
    depsFailureBadgeTooltipNode = <div className="text-xs text-muted-foreground">{depsFailureBadge.tooltip}</div>
  }

  const depsStatusIndicatorNode = (
    <InlineItemRow
      className={cn("inline-flex", depsUi.varsClassName, depsUi.textClassName, "text-xs")}
      items={[
        {
          key: "depsStatus",
          Icon: depsUi.Icon ?? null,
          iconClassName: depsUi.iconClassName,
          text: depsStatusLabel,
        },
      ]}
    />
  )

  let depsStatusWithOptionalErrorTooltipNode: React.ReactNode = depsStatusIndicatorNode
  if (showDraftErrorTooltip && props.depsErr) {
    depsStatusWithOptionalErrorTooltipNode = (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">{depsStatusIndicatorNode}</span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="max-w-[320px] space-y-1">
              <div className="text-xs text-muted-foreground whitespace-normal break-words">{String(props.depsErr)}</div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  } else if (configured && depsUi.status === "FAILED" && showDepsFailureBadgeIcon && depsFailureBadge?.code) {
    depsStatusWithOptionalErrorTooltipNode = (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">{depsStatusIndicatorNode}</span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="max-w-[320px] space-y-1">
              <div className="font-mono text-xs text-destructive">{String(depsFailureBadge.code)}</div>
              {depsFailureBadgeTooltipNode}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  const depsFooter = <div className="inline-flex items-center gap-1.5">{depsStatusWithOptionalErrorTooltipNode}</div>

  return (
    <>
      <WorkflowDepsManagerSheet
        open={props.sheetOpen}
        onOpenChange={props.onSheetOpenChange}
        trigger={
          <WorkflowSettingsConfigCard
            title={t("workflows.dependencies")}
            icon={<Package className="size-3.5" aria-hidden="true" />}
            value={configured ? count : t("common.notConfigured")}
            valueClassName={configured ? "font-mono" : "text-base"}
            footer={depsFooter}
          />
        }
        workflowId={props.workflowId}
        depsDraftJson={props.depsDraftJson}
        onDepsDraftJsonChange={props.onDepsDraftJsonChange}
        depsJson={props.depsJson}
        depsErr={props.depsErr}
        onDepsErrChange={props.onDepsErrChange}
        depsStatus={props.depsStatus}
        depsFailureBadge={props.depsFailureBadge ?? null}
        depsSavePending={props.depsSavePending}
        depsInstallPending={props.depsInstallPending === true}
        onSaveDepsDraft={props.onSaveDepsDraft}
        depsInstallErr={props.depsInstallErr}
        onInstallDeps={props.onInstallDeps}
        activeTab={props.activeTab}
        onActiveTabChange={props.onActiveTabChange}
        loadLogs={props.loadLogs}
        contentRef={props.sheetContentRef}
      />
    </>
  )
}
