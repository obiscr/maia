"use client"

import { useI18n } from "@/components/i18n-provider"
import { WorkflowSettingsConfigCard } from "@/components/workflows/editor/workflow-settings-config-card"
import { ListTree } from "lucide-react"

export function WorkflowStepsSection(props: {
  stepsCount: number
  selectedCount: number
  onOpenStepSheet: () => void
}) {
  const { t } = useI18n()

  return (
    <WorkflowSettingsConfigCard
      title={t("common.steps")}
      icon={<ListTree className="size-3.5" aria-hidden="true" />}
      value={props.stepsCount}
      valueClassName="font-mono"
      onClick={props.onOpenStepSheet}
    />
  )
}
