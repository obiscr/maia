"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { WorkflowGraphCanvasWrapper } from "@/components/graph/workflow-graph-canvas-wrapper"
import { WorkflowStepSheet } from "@/components/workflows/sheets/workflow-step-sheet"
import { WorkflowImportSheet } from "@/components/workflows/sheets/workflow-import-sheet"
import { AgentButton } from "@/components/ui/agent-button"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FieldLabel } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TextareaWithChrome } from "@/components/common/textarea-with-chrome"

import { toast } from "@/lib/client/toast"
import { downloadBlob } from "@/lib/client/download"
import { Bot, Download, History, Play, Plus, Pencil, Save, Trash2Icon, Upload, XCircle } from "lucide-react"
import { StandardDeleteDialog } from "@/components/common/standard-confirm-dialog"
import { useI18n } from "@/components/i18n-provider"
import { useWorkflowEditorApi } from "@/components/workflows/editor/use-workflow-editor-api"
import { useWorkflowEditorData } from "@/components/workflows/editor/use-workflow-editor-data"
import { useWorkflowEditorGraph } from "@/components/workflows/editor/use-workflow-editor-graph"
import { WorkflowSettingsPanel } from "@/components/workflows/editor/workflow-settings-panel"
import { StandardActionDialog } from "@/components/common/standard-action-dialog"
import { StandardPageHeader } from "@/components/common/standard-page-header"
import { HeaderActions } from "@/components/common/header-actions"
import { DetailPageLayout } from "@/components/common/detail-page-layout"
import { LoadingState } from "@/components/common/loading-state"
import { Spinner } from "@/components/ui/spinner"
import { useStandardDialog } from "@/hooks/use-standard-dialog"
import { useIsBelowBreakpoint } from "@/hooks/use-mobile"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"
import { normalizeFilenameStem } from "@/lib/shared/filename"
import { PageLoadError } from "@/components/common/page-load-error"
import { resolveWorkflowDepsDisplayError } from "@/lib/shared/error-display/adapters/workflow-deps"
import { InlineItemRow } from "@/components/common/inline-item-row"

export default function WorkflowEditClient({ workflowId }: { workflowId: string }) {
  const { t, locale } = useI18n()
  const isCompact = useIsBelowBreakpoint(1024)
  const searchParams = useSearchParams()
  const [compactTab, setCompactTab] = React.useState<"canvas" | "details">("canvas")
  const [importOpen, setImportOpen] = React.useState(false)
  const [exportOpen, setExportOpen] = React.useState(false)
  const [includeEnv, setIncludeEnv] = React.useState(false)
  const [exportPending, setExportPending] = React.useState(false)
  const [createVersionPending, setCreateVersionPending] = React.useState(false)
  const [createVersionOpen, setCreateVersionOpen] = React.useState(false)
  const [createVersionDescription, setCreateVersionDescription] = React.useState("")
  const api = useWorkflowEditorApi({ workflowId })
  const inputSpecUnsavedDialog = useStandardDialog({ closeOnConfirm: false })
  const outputsSpecUnsavedDialog = useStandardDialog({ closeOnConfirm: false })
  const deleteWorkflowDialog = useStandardDialog()
  const deleteStepDialog = useStandardDialog()
  const bulkDeleteDialog = useStandardDialog()
  const clearCanvasDialog = useStandardDialog()
  const data = useWorkflowEditorData({
    workflowId,
    locale,
    t,
    api,
    onRequestInputSpecCloseConfirm: inputSpecUnsavedDialog.openDialog,
    onRequestOutputsSpecCloseConfirm: outputsSpecUnsavedDialog.openDialog,
  })
  const [deleteStepKey, setDeleteStepKey] = React.useState<string | null>(null)

  React.useEffect(() => {
    // Mirror external "saving" state so the dialog can't be dismissed mid-save.
    inputSpecUnsavedDialog.setPending(data.saving)
    outputsSpecUnsavedDialog.setPending(data.saving)
  }, [data.saving, inputSpecUnsavedDialog.setPending, outputsSpecUnsavedDialog.setPending])

  React.useEffect(() => {
    deleteWorkflowDialog.closeDialog()
    deleteStepDialog.closeDialog()
    bulkDeleteDialog.closeDialog()
    clearCanvasDialog.closeDialog()
    inputSpecUnsavedDialog.closeDialog()
    outputsSpecUnsavedDialog.closeDialog()
    setDeleteStepKey(null)
    setCreateVersionOpen(false)
    setCreateVersionDescription("")
  }, [
    workflowId,
    bulkDeleteDialog.closeDialog,
    clearCanvasDialog.closeDialog,
    deleteStepDialog.closeDialog,
    deleteWorkflowDialog.closeDialog,
    inputSpecUnsavedDialog.closeDialog,
    outputsSpecUnsavedDialog.closeDialog,
  ])

  const graph = useWorkflowEditorGraph({
    workflowId,
    wf: data.wf,
    setWf: data.setWf,
    persistStepsDraft: data.saveStepsDraft,
    onRequestDeleteStep: (stepKey) => {
      setDeleteStepKey(stepKey)
      deleteStepDialog.openDialog()
    },
    onRequestDeleteSelectedSteps: () => {
      bulkDeleteDialog.openDialog()
    },
  })

  const canvasAutoSaveIndicator =
    graph.autoSaveState === "saving" ? (
      <InlineItemRow
        className="text-sm text-muted-foreground"
        iconSizeClassName="size-4"
        items={[
          {
            key: "autosave",
            Icon: Spinner,
            text: t("common.saving"),
          },
        ]}
      />
    ) : graph.autoSaveState === "error" ? (
      <InlineItemRow
        className="text-sm"
        iconSizeClassName="size-4"
        items={[
          {
            key: "autosaveError",
            Icon: XCircle,
            iconClassName: "text-destructive",
            text: t("errors.SAVE_FAILED"),
            textClassName: "text-destructive",
            tooltip: graph.autoSaveError ?? t("errors.SAVE_FAILED"),
          },
        ]}
      />
    ) : null

  // IMPORTANT: Hooks must stay above any conditional returns (Rules of Hooks).
  // Derive deps failure display info even when `data.wf` is not ready yet.
  const depsFailure = React.useMemo(() => {
    const wf = data.wf
    const depsErrorCode =
      wf && typeof wf === "object" && "depsErrorCode" in wf ? (wf as { depsErrorCode?: unknown }).depsErrorCode : null
    const depsErrorMessage =
      wf && typeof wf === "object" && "depsErrorMessage" in wf
        ? (wf as { depsErrorMessage?: unknown }).depsErrorMessage
        : null
    const depsErrorMetaJson =
      wf && typeof wf === "object" && "depsErrorMetaJson" in wf
        ? (wf as { depsErrorMetaJson?: unknown }).depsErrorMetaJson
        : null
    return resolveWorkflowDepsDisplayError({
      depsErrorCode: typeof depsErrorCode === "string" ? depsErrorCode : null,
      depsErrorMessage: typeof depsErrorMessage === "string" ? depsErrorMessage : null,
      depsErrorMetaJson: typeof depsErrorMetaJson === "string" ? depsErrorMetaJson : null,
    })
  }, [data.wf])

  async function doExport() {
    if (exportPending) return
    setExportPending(true)
    try {
      const json = await apiFetchJson<{
        workflow?: { id?: string; name?: string }
        data?: { meta?: { name?: string } }
      }>(`/api/workflows/${workflowId}/export?includeEnv=${includeEnv ? "1" : "0"}`, { cache: "no-store" })
      const wfId = String(json?.workflow?.id ?? workflowId).toUpperCase()
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

  async function doCreateVersion() {
    if (createVersionPending) return
    setCreateVersionPending(true)
    try {
      await api.createWorkflowVersion({ description: createVersionDescription })
      toast.success(t("workflows.versionCreatedToast"))
      setCreateVersionOpen(false)
      setCreateVersionDescription("")
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
    } finally {
      setCreateVersionPending(false)
    }
  }

  // Support one-click deep-linking into dependency installation after import.
  const action = searchParams.get("action") || ""
  React.useEffect(() => {
    if (action !== "installDeps") return
    if (!data.wf) return
    data.setDepsSheetTab("deps")
    data.setDepsSheetOpen(true)
  }, [action, data.wf])

  if (data.loading) {
    return <LoadingState textKey="common.loading" spinner placement="top" minHeightClassName="min-h-[40vh]" />
  }
  if (!data.wf) {
    const e = data.loadErr ?? new Error("WORKFLOW_LOAD_FAILED")
    return (
      <PageLoadError error={e} onRetry={() => void data.load()} backHref="/workflows" backLabelKey="nav.workflows" />
    )
  }
  const wf = data.wf

  const modalsNode = (
    <>
      <StandardDeleteDialog
        open={deleteWorkflowDialog.open}
        onOpenChange={deleteWorkflowDialog.onOpenChange}
        title={
          wf
            ? t("workflows.deleteWorkflowActionTitle", { name: wf.name })
            : t("workflows.deleteWorkflowActionTitleFallback")
        }
        description={t("workflows.deleteWorkflowActionDescription")}
        onConfirm={async () => {
          await deleteWorkflowDialog.confirm(data.deleteWorkflow)
        }}
        pending={deleteWorkflowDialog.pending}
      />
      <StandardDeleteDialog
        open={deleteStepDialog.open}
        onOpenChange={(o) => {
          if (!o && deleteStepDialog.pending) return
          deleteStepDialog.onOpenChange(o)
          if (!o) setDeleteStepKey(null)
        }}
        title={t("workflows.deleteStepAction")}
        description={t("workflows.deleteStepActionDescription")}
        onConfirm={() => {
          if (!deleteStepKey) return
          return deleteStepDialog.confirm(() => graph.confirmDeleteStep(deleteStepKey)).then(() => {})
        }}
        pending={deleteStepDialog.pending}
      />
      <StandardDeleteDialog
        open={bulkDeleteDialog.open}
        onOpenChange={(o) => {
          if (!o && bulkDeleteDialog.pending) return
          bulkDeleteDialog.onOpenChange(o)
        }}
        title={t("workflows.deleteSelectedStepsTitle", { n: graph.selectedGraphStepKeys.length })}
        description={t("workflows.deleteSelectedStepsDescription")}
        onConfirm={async () => {
          await bulkDeleteDialog.confirm(graph.confirmDeleteSelectedSteps)
        }}
        pending={bulkDeleteDialog.pending}
      />
      <StandardDeleteDialog
        open={clearCanvasDialog.open}
        onOpenChange={(o) => {
          if (!o && clearCanvasDialog.pending) return
          clearCanvasDialog.onOpenChange(o)
        }}
        title={t("workflows.clearCanvasTitle")}
        description={t("workflows.clearCanvasDescription")}
        onConfirm={async () => {
          await clearCanvasDialog.confirm(graph.confirmClearCanvas)
        }}
        pending={clearCanvasDialog.pending}
      />
      <StandardActionDialog
        open={inputSpecUnsavedDialog.open}
        onOpenChange={inputSpecUnsavedDialog.onOpenChange}
        title={t("common.unsavedChanges")}
        description={t("workflows.inputSpec.unsavedDescription")}
        pending={data.saving}
        actions={[
          {
            key: "cancel",
            kind: "cancel",
            label: t("common.keepEditingAction"),
            icon: <Pencil className="h-4 w-4" />,
            disabled: data.saving,
            onClick: () => {
              inputSpecUnsavedDialog.closeDialog()
            },
          },
          {
            key: "discard",
            label: t("common.discardAction"),
            icon: <Trash2Icon className="h-4 w-4" />,
            variant: "destructive",
            disabled: data.saving,
            onClick: () => {
              data.discardAndCloseInputSpec()
              inputSpecUnsavedDialog.closeDialog()
            },
          },
          {
            key: "save",
            label: data.saving ? t("common.saving") : t("common.saveAction"),
            icon: data.saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />,
            disabled: data.saving,
            onClick: async () => {
              const ok = await data.saveAndCloseInputSpecSheet()
              if (ok) inputSpecUnsavedDialog.closeDialog()
            },
          },
        ]}
      />
      <StandardActionDialog
        open={outputsSpecUnsavedDialog.open}
        onOpenChange={outputsSpecUnsavedDialog.onOpenChange}
        title={t("common.unsavedChanges")}
        description={t("workflows.outputsSpec.unsavedDescription")}
        pending={data.saving}
        actions={[
          {
            key: "cancel",
            kind: "cancel",
            label: t("common.keepEditingAction"),
            icon: <Pencil className="h-4 w-4" />,
            disabled: data.saving,
            onClick: () => {
              outputsSpecUnsavedDialog.closeDialog()
            },
          },
          {
            key: "discard",
            label: t("common.discardAction"),
            icon: <Trash2Icon className="h-4 w-4" />,
            variant: "destructive",
            disabled: data.saving,
            onClick: () => {
              data.discardAndCloseOutputsSpec()
              outputsSpecUnsavedDialog.closeDialog()
            },
          },
          {
            key: "save",
            label: data.saving ? t("common.saving") : t("common.saveAction"),
            icon: data.saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />,
            disabled: data.saving,
            onClick: async () => {
              const ok = await data.saveAndCloseOutputsSpecSheet()
              if (ok) outputsSpecUnsavedDialog.closeDialog()
            },
          },
        ]}
      />
      <WorkflowImportSheet open={importOpen} onOpenChange={setImportOpen} />
      <StandardActionDialog
        open={createVersionOpen}
        onOpenChange={(o) => !createVersionPending && setCreateVersionOpen(o)}
        title={t("workflows.createVersionActionDialogTitle")}
        description={
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">{t("workflows.createVersionActionDialogDescription")}</div>
            <div>
              <FieldLabel htmlFor={`wf-create-version-desc-${workflowId}`} className="sr-only">
                {t("workflows.createVersionActionDialogNoteLabel")}
              </FieldLabel>
              <TextareaWithChrome
                id={`wf-create-version-desc-${workflowId}`}
                value={createVersionDescription}
                onChange={(e) => setCreateVersionDescription(e.target.value)}
                placeholder={t("workflows.createVersionActionDialogNotePlaceholder")}
                rows={4}
                className="max-h-40"
              />
            </div>
          </div>
        }
        pending={createVersionPending}
        actions={[
          {
            key: "cancel",
            kind: "cancel",
            disabled: createVersionPending,
            onClick: () => setCreateVersionOpen(false),
          },
          {
            key: "create",
            label: createVersionPending ? t("workflows.creatingVersion") : t("workflows.createVersionAction"),
            icon: createVersionPending ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />,
            disabled: createVersionPending,
            onClick: () => void doCreateVersion(),
          },
        ]}
      />

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
                    id={`wf-export-include-env-${workflowId}`}
                    checked={includeEnv}
                    onCheckedChange={(v) => setIncludeEnv(v === true)}
                  />
                  <Label
                    htmlFor={`wf-export-include-env-${workflowId}`}
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
  )

  const headerNode = (
    <StandardPageHeader
      title={wf.name}
      description={
        <div className="space-y-2">
          <div>{wf.description ? wf.description : t("workflows.editWorkflowDescription")}</div>
        </div>
      }
      right={
        <HeaderActions
          iconOnlyBelow="lg"
          overflow
          overflowAlign="end"
          sections={[
            {
              key: "primary",
              items: [
                {
                  key: "start-run",
                  label: t("workflows.createJobAction"),
                  icon: <Play aria-hidden="true" />,
                  href: `/jobs?action=new&workflowId=${encodeURIComponent(workflowId)}`,
                  pinned: true,
                },
                {
                  key: "save",
                  label: createVersionPending ? t("workflows.creatingVersion") : t("workflows.createVersionAction"),
                  icon: createVersionPending ? <Spinner className="h-4 w-4" /> : <Save aria-hidden="true" />,
                  disabled: createVersionPending,
                  onClick: () => setCreateVersionOpen(true),
                  pinned: true,
                  variant: "secondary",
                },
              ],
            },
            {
              key: "versions",
              items: [
                {
                  key: "versions",
                  label: t("workflows.versions.title"),
                  icon: <History className="h-4 w-4" aria-hidden="true" />,
                  href: `/workflows/${workflowId}/versions`,
                  overflowOnly: true,
                },
              ],
            },
            {
              key: "import-export",
              items: [
                {
                  key: "import",
                  label: t("common.importAction"),
                  icon: <Download className="h-4 w-4" aria-hidden="true" />,
                  onClick: () => setImportOpen(true),
                  overflowOnly: true,
                },
                {
                  key: "export",
                  label: t("common.exportAction"),
                  icon: <Upload className="h-4 w-4" aria-hidden="true" />,
                  onClick: () => setExportOpen(true),
                  overflowOnly: true,
                  disabled: exportPending,
                },
              ],
            },
            {
              key: "danger",
              items: [
                {
                  key: "delete",
                  label: t("workflows.deleteWorkflowAction"),
                  icon: <Trash2Icon className="h-4 w-4" aria-hidden="true" />,
                  onClick: () => deleteWorkflowDialog.openDialog(),
                  overflowOnly: true,
                  disabled: deleteWorkflowDialog.pending,
                  menuVariant: "destructive",
                },
              ],
            },
          ]}
        />
      }
    />
  )

  return (
    <DetailPageLayout
      variant="fill"
      modals={modalsNode}
      header={headerNode}
      // Desktop: fill remaining viewport height inside the app chrome.
      // RootLayout: `SidebarInset` uses `h-svh`, `SiteHeader` is `--maia-header-h` (64px),
      // and `ScrollContainerProvider` adds `p-4` (2rem vertical padding).
      className={["flex min-h-0 flex-1 flex-col overflow-hidden", "lg:h-[calc(100svh-var(--maia-header-h)-2rem)]"].join(
        " ",
      )}
      bodyClassName="min-h-0 flex-1 overflow-hidden"
    >
      {/* Body: Desktop (>=lg) = split view; Compact (<lg) = segmented switch (Canvas / Details) */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {isCompact ? (
          <Tabs
            value={compactTab}
            onValueChange={(v) => setCompactTab(v as "canvas" | "details")}
            className="flex h-full min-h-0 flex-col gap-3"
          >
            {/* "Segment" = iOS-style segmented control (tabs styled as adjacent segments) */}
            <div className="shrink-0">
              <TabsList className="w-full">
                <TabsTrigger value="canvas" className="flex-1">
                  {t("common.tabs.editor")}
                </TabsTrigger>
                <TabsTrigger value="details" className="flex-1">
                  {t("common.tabs.details")}
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="canvas" className="min-h-0 flex-1">
              <WorkflowGraphCanvasWrapper
                mode="edit"
                workflowId={workflowId}
                steps={wf.steps}
                className="h-full"
                enableNodeContextMenu
                enableEditCanvasContextMenu
                onRequestClearCanvas={() => clearCanvasDialog.openDialog()}
                headerRight={canvasAutoSaveIndicator}
                headerLeft={
                  <div className="flex flex-wrap items-center gap-2">
                    <AgentButton asChild size="sm">
                      <Link href={`/workflows/${workflowId}/agent`}>
                        <Bot className="size-4" />
                        {t("workflows.aiOrchestrateAction")}
                      </Link>
                    </AgentButton>

                    <Button variant="secondary" size="sm" onClick={graph.addStep}>
                      <Plus className="size-4" />
                      {t("workflows.addStepAction")}
                    </Button>
                  </div>
                }
                onEditStep={graph.handleEditStep}
                onDeleteStep={graph.handleDeleteStep}
                onConnectSteps={graph.connectSteps}
                onDisconnectSteps={graph.disconnectSteps}
                selectedStepKeys={graph.selectedGraphStepKeys}
                onSelectedStepKeysChange={graph.handleSelectedStepKeysChange}
                onDeleteSelectedSteps={graph.handleDeleteSelectedSteps}
              />
            </TabsContent>

            <TabsContent value="details" className="min-h-0 flex-1">
              <ScrollArea className="h-full">
                <div className="pb-[calc(1rem+env(safe-area-inset-bottom))] pr-3">
                  <WorkflowSettingsPanel
                    wf={wf}
                    depsInstallInFlight={data.depsInstallInFlight}
                    depsFailureBadge={
                      wf.depsStatus === "FAILED" &&
                      (depsFailure.displayCode || depsFailure.wrapperCode || depsFailure.wrapperMessage)
                        ? {
                            code: String(depsFailure.displayCode ?? depsFailure.wrapperCode ?? "UNKNOWN"),
                            tooltip:
                              depsFailure.wrapperCode && depsFailure.wrapperCode !== depsFailure.displayCode
                                ? `${depsFailure.wrapperCode}${depsFailure.wrapperMessage ? `: ${depsFailure.wrapperMessage}` : ""}`
                                : (depsFailure.wrapperMessage ?? depsFailure.wrapperCode ?? undefined),
                          }
                        : null
                    }
                    selectedGraphStepKeysCount={graph.selectedGraphStepKeys.length}
                    depsPreviewRows={data.depsTable.entries}
                    depsPreviewEmptyText={
                      data.depsTable.parseError
                        ? data.depsTable.parseError
                        : data.depsErr
                          ? data.depsErr
                          : t("workflows.deps.empty")
                    }
                    envPreviewRows={data.envTable.entries}
                    envPreviewEmptyText={
                      data.envTable.parseError
                        ? data.envTable.parseError
                        : data.envErr
                          ? data.envErr
                          : t("workflows.env.empty")
                    }
                    onOpenStepSheet={() => graph.setStepSheetOpen(true)}
                    metaSheetOpen={data.metaSheetOpen}
                    onMetaSheetOpenChange={data.setMetaSheetOpen}
                    metaSheetContentRef={data.metaSheetContentRef}
                    metaNameDraft={data.metaNameDraft}
                    onMetaNameDraftChange={data.setMetaNameDraft}
                    metaDescriptionDraft={data.metaDescriptionDraft}
                    onMetaDescriptionDraftChange={data.setMetaDescriptionDraft}
                    metaSavePending={data.metaSavePending}
                    metaServerErr={data.metaServerErr}
                    onSaveMetaDraft={data.saveMetaDraft}
                    onResetMetaDraft={data.resetMetaDraft}
                    depsSheetOpen={data.depsSheetOpen}
                    onDepsSheetOpenChange={data.setDepsSheetOpen}
                    depsSheetContentRef={data.depsSheetContentRef}
                    depsDraftJson={data.depsDraftJson}
                    onDepsDraftJsonChange={data.setDepsDraftJson}
                    depsJson={data.depsJson}
                    depsErr={data.depsDraftErr}
                    onDepsErrChange={data.setDepsDraftErr}
                    depsSavePending={data.depsSavePending}
                    onSaveDepsDraft={data.saveDepsDraft}
                    depsInstallErr={data.depsInstallErr}
                    onInstallDeps={data.installDeps}
                    depsSheetTab={data.depsSheetTab}
                    onDepsSheetTabChange={data.setDepsSheetTab}
                    loadDepsInstallLogs={() => data.fetchDepsInstallLogs(500)}
                    envSheetOpen={data.envSheetOpen}
                    onEnvSheetOpenChange={data.setEnvSheetOpen}
                    envSheetContentRef={data.envSheetContentRef}
                    envDraftJson={data.envDraftJson}
                    onEnvDraftJsonChange={data.setEnvDraftJson}
                    envJson={data.envJson}
                    envErr={data.envDraftErr}
                    onEnvErrChange={data.setEnvDraftErr}
                    envSavePending={data.envSavePending}
                    onSaveEnvDraft={data.saveEnvDraft}
                    inputSpecSheetOpen={data.inputSpecSheetOpen}
                    onInputSpecSheetOpenChange={data.onInputSpecSheetOpenChange}
                    inputSpecSheetContentRef={data.inputSpecSheetContentRef}
                    inputSpecDraftJson={data.inputSpecDraftJson}
                    onInputSpecDraftJsonChange={data.onInputSpecDraftJsonChange}
                    inputSpecJson={data.inputSpecJson}
                    inputSpecDirty={data.inputSpecDirty}
                    inputSpecJsonOk={data.inputSpecJsonOk}
                    inputSpecErr={data.inputSpecErr}
                    inputSpecAiErr={data.inputSpecAiErr}
                    inputSpecAiPending={data.inputSpecAiPending}
                    inputSpecServerErr={data.inputSpecServerErr}
                    onGenerateInputSpecWithAi={data.generateInputSpecWithAi}
                    onInsertDefaultInputSpec={data.insertDefaultInputSpec}
                    onResetInputSpecDraft={data.resetInputSpecDraft}
                    onSaveAndCloseInputSpec={async () => {
                      await data.saveAndCloseInputSpecSheet()
                    }}
                    outputsSpecSheetOpen={data.outputsSpecSheetOpen}
                    onOutputsSpecSheetOpenChange={data.onOutputsSpecSheetOpenChange}
                    outputsSpecSheetContentRef={data.outputsSpecSheetContentRef}
                    outputsSpecDraftJson={data.outputsSpecDraftJson}
                    onOutputsSpecDraftJsonChange={data.onOutputsSpecDraftJsonChange}
                    outputsSpecJson={data.outputsSpecJson}
                    outputsSpecDirty={data.outputsSpecDirty}
                    outputsSpecJsonOk={data.outputsSpecJsonOk}
                    outputsSpecErr={data.outputsSpecErr}
                    outputsSpecAiErr={data.outputsSpecAiErr}
                    outputsSpecAiPending={data.outputsSpecAiPending}
                    outputsSpecServerErr={data.outputsSpecServerErr}
                    onGenerateOutputsSpecWithAi={data.generateOutputsSpecWithAi}
                    onInsertDefaultOutputsSpec={data.insertDefaultOutputsSpec}
                    onResetOutputsSpecDraft={data.resetOutputsSpecDraft}
                    onSaveAndCloseOutputsSpec={async () => {
                      await data.saveAndCloseOutputsSpecSheet()
                    }}
                    saving={data.saving}
                  />
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-4 lg:flex-row lg:overflow-hidden">
            <div className="lg:min-h-0 lg:flex-[0_0_200px] lg:overflow-auto">
              <WorkflowSettingsPanel
                wf={wf}
                depsInstallInFlight={data.depsInstallInFlight}
                depsFailureBadge={
                  wf.depsStatus === "FAILED" &&
                  (depsFailure.displayCode || depsFailure.wrapperCode || depsFailure.wrapperMessage)
                    ? {
                        code: String(depsFailure.displayCode ?? depsFailure.wrapperCode ?? "UNKNOWN"),
                        tooltip:
                          depsFailure.wrapperCode && depsFailure.wrapperCode !== depsFailure.displayCode
                            ? `${depsFailure.wrapperCode}${depsFailure.wrapperMessage ? `: ${depsFailure.wrapperMessage}` : ""}`
                            : (depsFailure.wrapperMessage ?? depsFailure.wrapperCode ?? undefined),
                      }
                    : null
                }
                selectedGraphStepKeysCount={graph.selectedGraphStepKeys.length}
                depsPreviewRows={data.depsTable.entries}
                depsPreviewEmptyText={
                  data.depsTable.parseError
                    ? data.depsTable.parseError
                    : data.depsErr
                      ? data.depsErr
                      : t("workflows.deps.empty")
                }
                envPreviewRows={data.envTable.entries}
                envPreviewEmptyText={
                  data.envTable.parseError
                    ? data.envTable.parseError
                    : data.envErr
                      ? data.envErr
                      : t("workflows.env.empty")
                }
                onOpenStepSheet={() => graph.setStepSheetOpen(true)}
                metaSheetOpen={data.metaSheetOpen}
                onMetaSheetOpenChange={data.setMetaSheetOpen}
                metaSheetContentRef={data.metaSheetContentRef}
                metaNameDraft={data.metaNameDraft}
                onMetaNameDraftChange={data.setMetaNameDraft}
                metaDescriptionDraft={data.metaDescriptionDraft}
                onMetaDescriptionDraftChange={data.setMetaDescriptionDraft}
                metaSavePending={data.metaSavePending}
                metaServerErr={data.metaServerErr}
                onSaveMetaDraft={data.saveMetaDraft}
                onResetMetaDraft={data.resetMetaDraft}
                depsSheetOpen={data.depsSheetOpen}
                onDepsSheetOpenChange={data.setDepsSheetOpen}
                depsSheetContentRef={data.depsSheetContentRef}
                depsDraftJson={data.depsDraftJson}
                onDepsDraftJsonChange={data.setDepsDraftJson}
                depsJson={data.depsJson}
                depsErr={data.depsDraftErr}
                onDepsErrChange={data.setDepsDraftErr}
                depsSavePending={data.depsSavePending}
                onSaveDepsDraft={data.saveDepsDraft}
                depsInstallErr={data.depsInstallErr}
                onInstallDeps={data.installDeps}
                depsSheetTab={data.depsSheetTab}
                onDepsSheetTabChange={data.setDepsSheetTab}
                loadDepsInstallLogs={() => data.fetchDepsInstallLogs(500)}
                envSheetOpen={data.envSheetOpen}
                onEnvSheetOpenChange={data.setEnvSheetOpen}
                envSheetContentRef={data.envSheetContentRef}
                envDraftJson={data.envDraftJson}
                onEnvDraftJsonChange={data.setEnvDraftJson}
                envJson={data.envJson}
                envErr={data.envDraftErr}
                onEnvErrChange={data.setEnvDraftErr}
                envSavePending={data.envSavePending}
                onSaveEnvDraft={data.saveEnvDraft}
                inputSpecSheetOpen={data.inputSpecSheetOpen}
                onInputSpecSheetOpenChange={data.onInputSpecSheetOpenChange}
                inputSpecSheetContentRef={data.inputSpecSheetContentRef}
                inputSpecDraftJson={data.inputSpecDraftJson}
                onInputSpecDraftJsonChange={data.onInputSpecDraftJsonChange}
                inputSpecJson={data.inputSpecJson}
                inputSpecDirty={data.inputSpecDirty}
                inputSpecJsonOk={data.inputSpecJsonOk}
                inputSpecErr={data.inputSpecErr}
                inputSpecAiErr={data.inputSpecAiErr}
                inputSpecAiPending={data.inputSpecAiPending}
                inputSpecServerErr={data.inputSpecServerErr}
                onGenerateInputSpecWithAi={data.generateInputSpecWithAi}
                onInsertDefaultInputSpec={data.insertDefaultInputSpec}
                onResetInputSpecDraft={data.resetInputSpecDraft}
                onSaveAndCloseInputSpec={async () => {
                  await data.saveAndCloseInputSpecSheet()
                }}
                outputsSpecSheetOpen={data.outputsSpecSheetOpen}
                onOutputsSpecSheetOpenChange={data.onOutputsSpecSheetOpenChange}
                outputsSpecSheetContentRef={data.outputsSpecSheetContentRef}
                outputsSpecDraftJson={data.outputsSpecDraftJson}
                onOutputsSpecDraftJsonChange={data.onOutputsSpecDraftJsonChange}
                outputsSpecJson={data.outputsSpecJson}
                outputsSpecDirty={data.outputsSpecDirty}
                outputsSpecJsonOk={data.outputsSpecJsonOk}
                outputsSpecErr={data.outputsSpecErr}
                outputsSpecAiErr={data.outputsSpecAiErr}
                outputsSpecAiPending={data.outputsSpecAiPending}
                outputsSpecServerErr={data.outputsSpecServerErr}
                onGenerateOutputsSpecWithAi={data.generateOutputsSpecWithAi}
                onInsertDefaultOutputsSpec={data.insertDefaultOutputsSpec}
                onResetOutputsSpecDraft={data.resetOutputsSpecDraft}
                onSaveAndCloseOutputsSpec={async () => {
                  await data.saveAndCloseOutputsSpecSheet()
                }}
                saving={data.saving}
              />
            </div>

            {/* Right: Graph canvas */}
            <div className="min-h-0 flex-1">
              <WorkflowGraphCanvasWrapper
                mode="edit"
                workflowId={workflowId}
                steps={wf.steps}
                className="h-full"
                enableNodeContextMenu
                enableEditCanvasContextMenu
                onRequestClearCanvas={() => clearCanvasDialog.openDialog()}
                headerRight={canvasAutoSaveIndicator}
                headerLeft={
                  <div className="flex flex-wrap items-center gap-2">
                    <AgentButton asChild size="sm">
                      <Link href={`/workflows/${workflowId}/agent`}>
                        <Bot className="size-4" />
                        {t("workflows.aiOrchestrateAction")}
                      </Link>
                    </AgentButton>

                    <Button variant="secondary" size="sm" onClick={graph.addStep}>
                      <Plus className="size-4" />
                      {t("workflows.addStepAction")}
                    </Button>
                  </div>
                }
                onEditStep={graph.handleEditStep}
                onDeleteStep={graph.handleDeleteStep}
                onConnectSteps={graph.connectSteps}
                onDisconnectSteps={graph.disconnectSteps}
                selectedStepKeys={graph.selectedGraphStepKeys}
                onSelectedStepKeysChange={graph.handleSelectedStepKeysChange}
                onDeleteSelectedSteps={graph.handleDeleteSelectedSteps}
              />
            </div>
          </div>
        )}
      </div>

      {/* Step editor (sheet) */}
      <WorkflowStepSheet
        open={graph.stepSheetOpen}
        onOpenChange={graph.setStepSheetOpen}
        title={graph.selectedStep ? graph.selectedStep.name : t("common.steps")}
        emptyText={t("workflows.selectStepToEdit")}
        step={graph.selectedStep}
        workflowId={workflowId}
        workflowSteps={wf.steps.map((s) => ({ stepKey: s.stepKey, name: s.name }))}
        savePending={data.stepSavePending}
        onSaveStep={async ({ originalStepKey, draft }) => {
          if (!data.wf) return
          const current = data.wf

          const nextKey = (draft.stepKey ?? "").trim()
          const nextName = (draft.name ?? "").trim()
          if (!nextKey.length || !nextName.length) return
          if (!current.steps.every((x) => x.stepKey === originalStepKey || x.stepKey !== nextKey)) return

          let nextSteps = current.steps.map((x) => {
            if (x.stepKey === originalStepKey) {
              return {
                ...x,
                stepKey: nextKey,
                name: draft.name,
                timeoutMs: draft.timeoutMs ?? x.timeoutMs,
                scriptEsm: draft.scriptEsm,
              }
            }
            if (originalStepKey !== nextKey && x.deps.includes(originalStepKey)) {
              return { ...x, deps: x.deps.map((d) => (d === originalStepKey ? nextKey : d)) }
            }
            return x
          })

          data.setWf({ ...current, steps: nextSteps })
          graph.setSelectedStepKey(nextKey)
          graph.setSelectedGraphStepKeys((prev) => prev.map((k) => (k === originalStepKey ? nextKey : k)))
          const res = await data.saveStepsDraft(nextSteps)
          if (res.ok && res.didSave) toast.success(t("common.saved"))
        }}
      />
    </DetailPageLayout>
  )
}
