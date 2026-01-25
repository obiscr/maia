"use client"

import * as React from "react"
import { Boxes } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { WorkflowOutputsSpecManagerSheet } from "@/components/workflows/editor/workflow-outputspec-manager-sheet"
import { WorkflowSettingsConfigCard } from "@/components/workflows/editor/workflow-settings-config-card"
import { InlineItemRow } from "@/components/common/inline-item-row"
import { cn } from "@/lib/utils"
import { toUiWorkflowOutputsSpecStatus, workflowOutputsSpecStatusUiSpec } from "@/lib/shared/workflow-outputspec-status"

export function WorkflowOutputsSpecSection(props: {
  sheetOpen: boolean
  onSheetOpenChange: (open: boolean) => void
  sheetContentRef: React.RefObject<HTMLDivElement | null>

  outputsSpecDraftJson: string
  onOutputsSpecDraftJsonChange: (v: string) => void
  outputsSpecJson: string
  outputsSpecDirty: boolean
  outputsSpecJsonOk: boolean
  outputsSpecErr: string | null
  outputsSpecAiErr: string | null
  outputsSpecAiPending: boolean
  outputsSpecServerErr: unknown

  onGenerateWithAi: () => void | Promise<void>
  onInsertDefault: () => void
  onResetDraft: () => void
  onSaveAndClose: () => void | Promise<void>
  saving: boolean
}) {
  const { t } = useI18n()
  const configured = !!props.outputsSpecJson.trim().length
  const invalid = !props.outputsSpecJsonOk || !!props.outputsSpecErr
  const outputsSpecUiStatus = toUiWorkflowOutputsSpecStatus({
    configured,
    dirty: props.outputsSpecDirty,
    invalid,
  })
  const outputsSpecUi = workflowOutputsSpecStatusUiSpec(outputsSpecUiStatus)

  let outputsSpecStatusLabel: string
  switch (outputsSpecUi.status) {
    case "DIRTY":
      outputsSpecStatusLabel = t("common.unsavedChanges")
      break
    case "NOT_CONFIGURED":
      outputsSpecStatusLabel = t("common.notConfigured")
      break
    case "VALID":
      outputsSpecStatusLabel = t("workflows.outputsSpec.validJson")
      break
    case "INVALID":
      outputsSpecStatusLabel = t("errors.INVALID_JSON")
      break
    default:
      outputsSpecStatusLabel = outputsSpecUi.status
      break
  }

  const outputsSpecStatusIndicatorNode = (
    <InlineItemRow
      className={cn("inline-flex", outputsSpecUi.varsClassName, outputsSpecUi.textClassName, "text-xs")}
      items={[
        {
          key: "outputsSpecStatus",
          Icon: outputsSpecUi.Icon ?? null,
          iconClassName: outputsSpecUi.iconClassName,
          text: outputsSpecStatusLabel,
        },
      ]}
    />
  )
  const outputsSpecFooter = <div className="inline-flex items-center gap-1.5">{outputsSpecStatusIndicatorNode}</div>

  return (
    <>
      <WorkflowOutputsSpecManagerSheet
        open={props.sheetOpen}
        onOpenChange={props.onSheetOpenChange}
        trigger={
          <WorkflowSettingsConfigCard
            title={t("workflows.outputsSpec.title")}
            icon={<Boxes className="size-3.5" aria-hidden="true" />}
            value={configured ? t("common.configured") : t("common.notConfigured")}
            valueClassName="text-base"
            footer={outputsSpecFooter}
          />
        }
        contentRef={props.sheetContentRef}
        outputsSpecDraftJson={props.outputsSpecDraftJson}
        onOutputsSpecDraftJsonChange={props.onOutputsSpecDraftJsonChange}
        outputsSpecJson={props.outputsSpecJson}
        outputsSpecDirty={props.outputsSpecDirty}
        outputsSpecJsonOk={props.outputsSpecJsonOk}
        outputsSpecErr={props.outputsSpecErr}
        outputsSpecAiErr={props.outputsSpecAiErr}
        outputsSpecAiPending={props.outputsSpecAiPending}
        outputsSpecServerErr={props.outputsSpecServerErr}
        onGenerateWithAi={props.onGenerateWithAi}
        onInsertDefault={props.onInsertDefault}
        onResetDraft={props.onResetDraft}
        onSaveAndClose={props.onSaveAndClose}
        saving={props.saving}
      />
    </>
  )
}
