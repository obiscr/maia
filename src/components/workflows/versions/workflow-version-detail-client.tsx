"use client"

import * as React from "react"
import Link from "next/link"
import { Download, RotateCcw, Upload } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { StandardPageHeader } from "@/components/common/standard-page-header"
import { StandardActionDialog } from "@/components/common/standard-action-dialog"
import { HeaderActions } from "@/components/common/header-actions"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { CreateVersionFromSnapshotAction } from "@/components/common/create-version-from-snapshot-action"
import { DetailPageLayout } from "@/components/common/detail-page-layout"
import { LoadingState } from "@/components/common/loading-state"
import { Spinner } from "@/components/ui/spinner"

import { useWorkflowVersionDetail } from "@/components/workflows/versions/use-workflow-version-detail"
import { WorkflowVersionSnapshotTabsPanel } from "@/components/workflows/versions/workflow-version-snapshot-tabs-panel"
import { WorkflowVersionSnapshotTabsPanelSkeleton } from "@/components/workflows/versions/workflow-version-snapshot-tabs-panel-skeleton"
import { WorkflowImportSheet } from "@/components/workflows/sheets/workflow-import-sheet"
import { apiFetchJson } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"
import { downloadBlob } from "@/lib/client/download"
import { tApiError } from "@/lib/shared/i18n/error"
import { normalizeFilenameStem } from "@/lib/shared/filename"
import { PageLoadError } from "@/components/common/page-load-error"
import { isRecord } from "@/lib/shared/lang/is-record"

export default function WorkflowVersionDetailClient(props: { workflowId: string; version: string }) {
  const { t } = useI18n()

  const detail = useWorkflowVersionDetail({ workflowId: props.workflowId, version: props.version })
  const [exportOpen, setExportOpen] = React.useState(false)
  const [includeEnv, setIncludeEnv] = React.useState(false)
  const [exportPending, setExportPending] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)

  const data = detail.data
  const steps = detail.steps

  const snap = detail.snapshot
  const snapshotRec = isRecord(snap) ? snap : null
  const snapshotDependencies = typeof snapshotRec?.dependencies === "string" ? snapshotRec.dependencies : null
  const snapshotEnvJson = typeof snapshotRec?.envJson === "string" ? snapshotRec.envJson : null
  const snapshotInputSpec =
    typeof snapshotRec?.inputSpec === "string" ? snapshotRec.inputSpec : snapshotRec?.inputSpec == null ? null : null
  const snapshotOutputsSpec =
    typeof snapshotRec?.outputsSpec === "string"
      ? snapshotRec.outputsSpec
      : snapshotRec?.outputsSpec == null
        ? null
        : null

  const versionNum = data?.version?.version ?? (Number(props.version) || null)
  const titleVersion = versionNum != null ? `v${String(versionNum)}` : String(props.version)

  if (!data) {
    if (detail.loading) {
      return <LoadingState textKey="common.loading" spinner placement="top" minHeightClassName="min-h-[40vh]" />
    }
    if (detail.error) {
      return (
        <PageLoadError
          error={detail.error}
          onRetry={() => void detail.refresh()}
          backHref={`/workflows/${props.workflowId}/versions`}
          backLabelKey="workflows.versions.title"
        />
      )
    }
  }

  async function doExport() {
    if (exportPending) return
    setExportPending(true)
    try {
      type WorkflowVersionExportResponse = {
        workflow?: { id?: string; name?: string }
        data?: { meta?: { name?: string } }
      } & Record<string, unknown>
      const json = await apiFetchJson<WorkflowVersionExportResponse>(
        `/api/workflows/${props.workflowId}/versions/${encodeURIComponent(props.version)}/export?includeEnv=${includeEnv ? "1" : "0"}`,
        { cache: "no-store" },
      )
      const wfId = String(json?.workflow?.id ?? props.workflowId).toUpperCase()
      const wfName = String(json?.workflow?.name ?? json?.data?.meta?.name ?? "workflow")
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

  return (
    <CreateVersionFromSnapshotAction workflowId={props.workflowId} snapshotVersion={versionNum} navigateMode="replace">
      {({ open, pending, disabled }) => (
        <DetailPageLayout
          variant="fill"
          modals={
            <>
              <WorkflowImportSheet open={importOpen} onOpenChange={setImportOpen} />
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
                            id={`wf-export-include-env-${props.workflowId}-v${String(props.version)}`}
                            checked={includeEnv}
                            onCheckedChange={(v) => setIncludeEnv(v === true)}
                          />
                          <Label
                            htmlFor={`wf-export-include-env-${props.workflowId}-v${String(props.version)}`}
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
            </>
          }
          header={
            <StandardPageHeader
              title={t("workflows.versions.detailTitle", { version: titleVersion })}
              description={
                data?.workflow?.name
                  ? t("workflows.versions.descriptionNamed", { name: data.workflow.name })
                  : t("workflows.versions.description")
              }
              right={
                <HeaderActions
                  iconOnlyBelow="md"
                  overflow
                  overflowAlign="end"
                  sections={[
                    {
                      key: "main",
                      items: [
                        {
                          key: "import",
                          label: t("common.importAction"),
                          icon: <Download className="size-4" aria-hidden="true" />,
                          onClick: () => setImportOpen(true),
                          overflowOnly: true,
                          disabled: exportPending,
                        },
                        {
                          key: "export",
                          label: t("common.exportAction"),
                          icon: <Upload className="size-4" aria-hidden="true" />,
                          onClick: () => setExportOpen(true),
                          overflowOnly: true,
                          disabled: detail.loading || exportPending,
                        },
                        {
                          key: "restore",
                          label: t("common.createActionVersionFromSnapshotAction"),
                          icon: <RotateCcw className="size-4" aria-hidden="true" />,
                          onClick: () => open(),
                          pinned: true,
                          variant: "secondary" as const,
                          disabled: detail.loading || !data || disabled || pending,
                        },
                      ],
                    },
                  ]}
                />
              }
            />
          }
          bodyClassName="min-h-0 flex-1 overflow-hidden"
        >
          <div className="min-h-0 h-full overflow-hidden">
            {detail.loading ? (
              <WorkflowVersionSnapshotTabsPanelSkeleton className="flex h-full min-h-0 flex-col text-card-foreground" />
            ) : !data ? (
              <div className="p-3 text-sm text-muted-foreground">
                {t("common.notFound")}{" "}
                <Button asChild variant="link" className="px-0">
                  <Link href={`/workflows/${props.workflowId}/versions`}>{t("common.backAction")}</Link>
                </Button>
              </div>
            ) : (
              <WorkflowVersionSnapshotTabsPanel
                className="flex h-full min-h-0 flex-col text-card-foreground"
                versionTitle={titleVersion}
                createdAt={data.version.createdAt ?? null}
                depsHash={detail.depsHash}
                description={data.version.description ?? null}
                steps={steps.map((s) => ({
                  stepKey: s.stepKey,
                  name: s.name,
                  timeoutMs: s.timeoutMs,
                  scriptEsm: s.scriptEsm,
                }))}
                dependencies={snapshotDependencies}
                envJson={snapshotEnvJson}
                inputSpec={snapshotInputSpec}
                outputsSpec={snapshotOutputsSpec}
              />
            )}
          </div>
        </DetailPageLayout>
      )}
    </CreateVersionFromSnapshotAction>
  )
}
