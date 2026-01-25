"use client"

import * as React from "react"
import { FileText } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { WorkflowInputSpecManagerSheet } from "@/components/workflows/editor/workflow-inputspec-manager-sheet"
import { WorkflowSettingsConfigCard } from "@/components/workflows/editor/workflow-settings-config-card"
import { InlineItemRow } from "@/components/common/inline-item-row"
import { cn } from "@/lib/utils"
import { toUiWorkflowInputSpecStatus, workflowInputSpecStatusUiSpec } from "@/lib/shared/workflow-inputspec-status"

export function WorkflowInputSpecSection(props: {
  sheetOpen: boolean
  onSheetOpenChange: (open: boolean) => void
  sheetContentRef: React.RefObject<HTMLDivElement | null>

  inputSpecDraftJson: string
  onInputSpecDraftJsonChange: (v: string) => void
  inputSpecJson: string
  inputSpecDirty: boolean
  inputSpecJsonOk: boolean
  inputSpecErr: string | null
  inputSpecAiErr: string | null
  inputSpecAiPending: boolean
  inputSpecServerErr: unknown

  onGenerateWithAi: () => void | Promise<void>
  onInsertDefault: () => void
  onResetDraft: () => void
  onSaveAndClose: () => void | Promise<void>
  saving: boolean
}) {
  const { t } = useI18n()
  const configured = !!props.inputSpecJson.trim().length
  const invalid = !props.inputSpecJsonOk || !!props.inputSpecErr
  const inputSpecUiStatus = toUiWorkflowInputSpecStatus({
    configured,
    dirty: props.inputSpecDirty,
    invalid,
  })
  const inputSpecUi = workflowInputSpecStatusUiSpec(inputSpecUiStatus)

  let inputSpecStatusLabel: string
  switch (inputSpecUi.status) {
    case "DIRTY":
      inputSpecStatusLabel = t("common.unsavedChanges")
      break
    case "NOT_CONFIGURED":
      inputSpecStatusLabel = t("common.notConfigured")
      break
    case "VALID":
      inputSpecStatusLabel = t("workflows.inputSpec.validJson")
      break
    case "INVALID":
      inputSpecStatusLabel = t("errors.INVALID_JSON")
      break
    default:
      inputSpecStatusLabel = inputSpecUi.status
      break
  }

  const inputSpecStatusIndicatorNode = (
    <InlineItemRow
      className={cn("inline-flex", inputSpecUi.varsClassName, inputSpecUi.textClassName, "text-xs")}
      items={[
        {
          key: "inputSpecStatus",
          Icon: inputSpecUi.Icon ?? null,
          iconClassName: inputSpecUi.iconClassName,
          text: inputSpecStatusLabel,
        },
      ]}
    />
  )
  const inputSpecFooter = <div className="inline-flex items-center gap-1.5">{inputSpecStatusIndicatorNode}</div>

  return (
    <>
      <WorkflowInputSpecManagerSheet
        open={props.sheetOpen}
        onOpenChange={props.onSheetOpenChange}
        trigger={
          <WorkflowSettingsConfigCard
            title={t("workflows.inputSpec.title")}
            icon={<FileText className="size-3.5" aria-hidden="true" />}
            value={configured ? t("common.configured") : t("common.notConfigured")}
            valueClassName="text-base"
            footer={inputSpecFooter}
          />
        }
        contentRef={props.sheetContentRef}
        inputSpecDraftJson={props.inputSpecDraftJson}
        onInputSpecDraftJsonChange={props.onInputSpecDraftJsonChange}
        inputSpecJson={props.inputSpecJson}
        inputSpecDirty={props.inputSpecDirty}
        inputSpecJsonOk={props.inputSpecJsonOk}
        inputSpecErr={props.inputSpecErr}
        inputSpecAiErr={props.inputSpecAiErr}
        inputSpecAiPending={props.inputSpecAiPending}
        inputSpecServerErr={props.inputSpecServerErr}
        onGenerateWithAi={props.onGenerateWithAi}
        onInsertDefault={props.onInsertDefault}
        onResetDraft={props.onResetDraft}
        onSaveAndClose={props.onSaveAndClose}
        saving={props.saving}
      />
    </>
  )
}
