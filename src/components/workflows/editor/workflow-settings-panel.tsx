"use client"

import * as React from "react"

import { WorkflowMetaSection } from "@/components/workflows/editor/workflow-meta-section"
import { WorkflowDepsSection } from "@/components/workflows/editor/workflow-deps-section"
import { WorkflowEnvSection } from "@/components/workflows/editor/workflow-env-section"
import { WorkflowInputSpecSection } from "@/components/workflows/editor/workflow-inputspec-section"
import { WorkflowOutputsSpecSection } from "@/components/workflows/editor/workflow-outputspec-section"
import { WorkflowStepsSection } from "@/components/workflows/editor/workflow-steps-section"
import type { DepsInstallLog } from "@/components/workflows/editor/use-workflow-editor-api"

export function WorkflowSettingsPanel(props: {
  wf: {
    id: string
    name: string
    description: string | null
    depsStatus: string
    steps: Array<{ stepKey: string; deps: string[] }>
  }

  depsFailureBadge?: { code: string; tooltip?: string } | null

  selectedGraphStepKeysCount: number
  depsPreviewRows: Array<{ name: string; version: string }>
  depsPreviewEmptyText: string

  envPreviewRows: Array<{ key: string; value: string }>
  envPreviewEmptyText: string

  onOpenStepSheet: () => void

  // Meta section
  metaSheetOpen: boolean
  onMetaSheetOpenChange: (open: boolean) => void
  metaSheetContentRef: React.RefObject<HTMLDivElement | null>
  metaNameDraft: string
  onMetaNameDraftChange: (name: string) => void
  metaDescriptionDraft: string
  onMetaDescriptionDraftChange: (description: string) => void
  metaSavePending: boolean
  metaServerErr: unknown
  onSaveMetaDraft: () => void | Promise<void>
  onResetMetaDraft: () => void

  // Deps section
  depsSheetOpen: boolean
  onDepsSheetOpenChange: (open: boolean) => void
  depsSheetContentRef: React.RefObject<HTMLDivElement | null>
  depsInstallInFlight?: boolean
  depsDraftJson: string
  onDepsDraftJsonChange: (v: string) => void
  depsJson: string
  depsErr: string | null
  onDepsErrChange: (e: string | null) => void
  depsSavePending: boolean
  onSaveDepsDraft: (opts?: { silentToast?: boolean }) => void | Promise<void>
  depsInstallErr: unknown
  onInstallDeps: () => void | Promise<void>
  depsSheetTab: "deps" | "logs"
  onDepsSheetTabChange: (tab: "deps" | "logs") => void
  loadDepsInstallLogs: () => Promise<{ logs: DepsInstallLog[] }>

  // Env section
  envSheetOpen: boolean
  onEnvSheetOpenChange: (open: boolean) => void
  envSheetContentRef: React.RefObject<HTMLDivElement | null>
  envDraftJson: string
  onEnvDraftJsonChange: (v: string) => void
  envJson: string
  envErr: string | null
  onEnvErrChange: (e: string | null) => void
  envSavePending: boolean
  onSaveEnvDraft: () => void | Promise<void>

  // InputSpec section
  inputSpecSheetOpen: boolean
  onInputSpecSheetOpenChange: (open: boolean) => void
  inputSpecSheetContentRef: React.RefObject<HTMLDivElement | null>
  inputSpecDraftJson: string
  onInputSpecDraftJsonChange: (v: string) => void
  inputSpecJson: string
  inputSpecDirty: boolean
  inputSpecJsonOk: boolean
  inputSpecErr: string | null
  inputSpecAiErr: string | null
  inputSpecAiPending: boolean
  inputSpecServerErr: unknown
  onGenerateInputSpecWithAi: () => void | Promise<void>
  onInsertDefaultInputSpec: () => void
  onResetInputSpecDraft: () => void
  onSaveAndCloseInputSpec: () => void | Promise<void>

  // OutputsSpec section
  outputsSpecSheetOpen: boolean
  onOutputsSpecSheetOpenChange: (open: boolean) => void
  outputsSpecSheetContentRef: React.RefObject<HTMLDivElement | null>
  outputsSpecDraftJson: string
  onOutputsSpecDraftJsonChange: (v: string) => void
  outputsSpecJson: string
  outputsSpecDirty: boolean
  outputsSpecJsonOk: boolean
  outputsSpecErr: string | null
  outputsSpecAiErr: string | null
  outputsSpecAiPending: boolean
  outputsSpecServerErr: unknown
  onGenerateOutputsSpecWithAi: () => void | Promise<void>
  onInsertDefaultOutputsSpec: () => void
  onResetOutputsSpecDraft: () => void
  onSaveAndCloseOutputsSpec: () => void | Promise<void>
  saving: boolean
}) {
  return (
    <div className="w-full space-y-3">
      <div className="grid grid-cols-1 gap-2">
        <WorkflowMetaSection
          workflowId={props.wf.id}
          sheetOpen={props.metaSheetOpen}
          onSheetOpenChange={props.onMetaSheetOpenChange}
          sheetContentRef={props.metaSheetContentRef}
          nameDraft={props.metaNameDraft}
          onNameDraftChange={props.onMetaNameDraftChange}
          descriptionDraft={props.metaDescriptionDraft}
          onDescriptionDraftChange={props.onMetaDescriptionDraftChange}
          savedName={props.wf.name}
          savedDescription={props.wf.description ?? ""}
          savePending={props.metaSavePending}
          serverErr={props.metaServerErr}
          onSave={props.onSaveMetaDraft}
          onResetDraft={props.onResetMetaDraft}
        />

        <WorkflowStepsSection
          stepsCount={props.wf.steps.length}
          selectedCount={props.selectedGraphStepKeysCount}
          onOpenStepSheet={props.onOpenStepSheet}
        />

        <WorkflowDepsSection
          workflowId={props.wf.id}
          sheetOpen={props.depsSheetOpen}
          onSheetOpenChange={props.onDepsSheetOpenChange}
          sheetContentRef={props.depsSheetContentRef}
          depsDraftJson={props.depsDraftJson}
          onDepsDraftJsonChange={props.onDepsDraftJsonChange}
          depsJson={props.depsJson}
          depsErr={props.depsErr}
          onDepsErrChange={props.onDepsErrChange}
          depsStatus={props.wf.depsStatus}
          depsFailureBadge={props.depsFailureBadge ?? null}
          depsSavePending={props.depsSavePending}
          depsInstallPending={props.depsInstallInFlight === true}
          onSaveDepsDraft={props.onSaveDepsDraft}
          depsInstallErr={props.depsInstallErr}
          onInstallDeps={props.onInstallDeps}
          activeTab={props.depsSheetTab}
          onActiveTabChange={props.onDepsSheetTabChange}
          loadLogs={props.loadDepsInstallLogs}
          previewRows={props.depsPreviewRows}
          previewEmptyText={props.depsPreviewEmptyText}
        />

        <WorkflowEnvSection
          sheetOpen={props.envSheetOpen}
          onSheetOpenChange={props.onEnvSheetOpenChange}
          sheetContentRef={props.envSheetContentRef}
          envDraftJson={props.envDraftJson}
          onEnvDraftJsonChange={props.onEnvDraftJsonChange}
          envJson={props.envJson}
          envErr={props.envErr}
          onEnvErrChange={props.onEnvErrChange}
          envSavePending={props.envSavePending}
          onSaveEnvDraft={props.onSaveEnvDraft}
          previewRows={props.envPreviewRows}
          previewEmptyText={props.envPreviewEmptyText}
        />

        <WorkflowInputSpecSection
          sheetOpen={props.inputSpecSheetOpen}
          onSheetOpenChange={props.onInputSpecSheetOpenChange}
          sheetContentRef={props.inputSpecSheetContentRef}
          inputSpecDraftJson={props.inputSpecDraftJson}
          onInputSpecDraftJsonChange={props.onInputSpecDraftJsonChange}
          inputSpecJson={props.inputSpecJson}
          inputSpecDirty={props.inputSpecDirty}
          inputSpecJsonOk={props.inputSpecJsonOk}
          inputSpecErr={props.inputSpecErr}
          inputSpecAiErr={props.inputSpecAiErr}
          inputSpecAiPending={props.inputSpecAiPending}
          inputSpecServerErr={props.inputSpecServerErr}
          onGenerateWithAi={props.onGenerateInputSpecWithAi}
          onInsertDefault={props.onInsertDefaultInputSpec}
          onResetDraft={props.onResetInputSpecDraft}
          onSaveAndClose={props.onSaveAndCloseInputSpec}
          saving={props.saving}
        />

        <WorkflowOutputsSpecSection
          sheetOpen={props.outputsSpecSheetOpen}
          onSheetOpenChange={props.onOutputsSpecSheetOpenChange}
          sheetContentRef={props.outputsSpecSheetContentRef}
          outputsSpecDraftJson={props.outputsSpecDraftJson}
          onOutputsSpecDraftJsonChange={props.onOutputsSpecDraftJsonChange}
          outputsSpecJson={props.outputsSpecJson}
          outputsSpecDirty={props.outputsSpecDirty}
          outputsSpecJsonOk={props.outputsSpecJsonOk}
          outputsSpecErr={props.outputsSpecErr}
          outputsSpecAiErr={props.outputsSpecAiErr}
          outputsSpecAiPending={props.outputsSpecAiPending}
          outputsSpecServerErr={props.outputsSpecServerErr}
          onGenerateWithAi={props.onGenerateOutputsSpecWithAi}
          onInsertDefault={props.onInsertDefaultOutputsSpec}
          onResetDraft={props.onResetOutputsSpecDraft}
          onSaveAndClose={props.onSaveAndCloseOutputsSpec}
          saving={props.saving}
        />
      </div>
    </div>
  )
}
