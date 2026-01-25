"use client"

import { useI18n } from "@/components/i18n-provider"
import { IdCard } from "lucide-react"

import { WorkflowMetaManagerSheet } from "@/components/workflows/editor/workflow-meta-manager-sheet"
import { WorkflowSettingsConfigCard } from "@/components/workflows/editor/workflow-settings-config-card"

export function WorkflowMetaSection(props: {
  workflowId: string

  sheetOpen: boolean
  onSheetOpenChange: (open: boolean) => void
  sheetContentRef: React.RefObject<HTMLDivElement | null>

  nameDraft: string
  onNameDraftChange: (name: string) => void
  descriptionDraft: string
  onDescriptionDraftChange: (description: string) => void
  savedName: string
  savedDescription: string

  savePending: boolean
  serverErr: unknown
  onSave: () => void | Promise<void>
  onResetDraft: () => void
}) {
  const { t } = useI18n()

  return (
    <WorkflowMetaManagerSheet
      open={props.sheetOpen}
      onOpenChange={props.onSheetOpenChange}
      contentRef={props.sheetContentRef}
      workflowId={props.workflowId}
      nameDraft={props.nameDraft}
      onNameDraftChange={props.onNameDraftChange}
      descriptionDraft={props.descriptionDraft}
      onDescriptionDraftChange={props.onDescriptionDraftChange}
      savedName={props.savedName}
      savedDescription={props.savedDescription}
      savePending={props.savePending}
      serverErr={props.serverErr}
      onSave={props.onSave}
      onResetDraft={props.onResetDraft}
      trigger={
        <WorkflowSettingsConfigCard
          title={t("workflows.meta.title")}
          icon={<IdCard className="size-3.5" aria-hidden="true" />}
          value={t("sidebar.settings")}
          valueClassName="text-base"
        />
      }
    />
  )
}
