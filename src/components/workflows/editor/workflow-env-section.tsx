"use client"

import * as React from "react"

import { useI18n } from "@/components/i18n-provider"
import { KeyRound } from "lucide-react"

import { WorkflowEnvManagerSheet } from "@/components/workflows/editor/workflow-env-manager-sheet"
import { type EnvPreviewRow } from "@/components/workflows/editor/workflow-env-preview-table"
import { WorkflowSettingsConfigCard } from "@/components/workflows/editor/workflow-settings-config-card"
import { InlineItemRow } from "@/components/common/inline-item-row"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { toUiWorkflowEnvStatus, workflowEnvStatusUiSpec } from "@/lib/shared/workflow-env-status"

export function WorkflowEnvSection(props: {
  envDraftJson: string
  onEnvDraftJsonChange: (v: string) => void
  envJson: string
  envErr: string | null
  onEnvErrChange: (e: string | null) => void
  envSavePending: boolean
  onSaveEnvDraft: () => void | Promise<void>
  sheetOpen: boolean
  onSheetOpenChange: (open: boolean) => void
  sheetContentRef: React.RefObject<HTMLDivElement | null>
  previewRows: EnvPreviewRow[]
  previewEmptyText?: string
}) {
  const { t } = useI18n()
  const count = props.previewRows.length
  const configured = count > 0
  const dirty = (props.envDraftJson || "{}").trim() !== (props.envJson || "{}").trim()

  const envUiStatus = toUiWorkflowEnvStatus({ configured, dirty, error: !!props.envErr })
  const envUi = workflowEnvStatusUiSpec(envUiStatus)

  let envStatusLabel: string
  switch (envUi.status) {
    case "FAILED":
      envStatusLabel = t("common.errorLabel")
      break
    case "DIRTY":
      envStatusLabel = t("common.unsavedChanges")
      break
    case "NOT_CONFIGURED":
      envStatusLabel = t("common.notConfigured")
      break
    case "READY":
      envStatusLabel = t("workflows.deps.status.ready")
      break
    default:
      envStatusLabel = envUi.status
      break
  }

  const envStatusIndicatorNode = (
    <InlineItemRow
      className={cn("inline-flex", envUi.varsClassName, envUi.textClassName, "text-xs")}
      items={[
        {
          key: "envStatus",
          Icon: envUi.Icon ?? null,
          iconClassName: envUi.iconClassName,
          text: envStatusLabel,
        },
      ]}
    />
  )

  let envStatusWithOptionalErrorTooltipNode: React.ReactNode = envStatusIndicatorNode
  if (props.envErr) {
    envStatusWithOptionalErrorTooltipNode = (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">{envStatusIndicatorNode}</span>
          </TooltipTrigger>
          <TooltipContent>
            <div className="max-w-[320px] space-y-1">
              <div className="text-xs text-muted-foreground whitespace-normal break-words">{String(props.envErr)}</div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }
  const envFooter = <div className="inline-flex items-center gap-1.5">{envStatusWithOptionalErrorTooltipNode}</div>

  return (
    <>
      <WorkflowEnvManagerSheet
        open={props.sheetOpen}
        onOpenChange={props.onSheetOpenChange}
        trigger={
          <WorkflowSettingsConfigCard
            title={t("workflows.env.title")}
            icon={<KeyRound className="size-3.5" aria-hidden="true" />}
            value={configured ? count : t("common.notConfigured")}
            valueClassName={configured ? "font-mono" : "text-base"}
            footer={envFooter}
          />
        }
        envDraftJson={props.envDraftJson}
        onEnvDraftJsonChange={props.onEnvDraftJsonChange}
        envJson={props.envJson}
        envErr={props.envErr}
        onEnvErrChange={props.onEnvErrChange}
        envSavePending={props.envSavePending}
        onSaveEnvDraft={props.onSaveEnvDraft}
        contentRef={props.sheetContentRef}
      />
    </>
  )
}
