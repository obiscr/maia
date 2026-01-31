"use client"

import { useI18n } from "@/components/i18n-provider"
import { FileText } from "lucide-react"
import { workflowInputSpecStatusUiSpec } from "@/lib/shared/workflow-inputspec-status"
import { cn } from "@/lib/utils"

export function WorkflowInputSpecSummaryCard(props: { configured: boolean }) {
  const { t } = useI18n()
  const ui = workflowInputSpecStatusUiSpec(props.configured ? "VALID" : "NOT_CONFIGURED")

  return (
    <div className="rounded-md border bg-muted/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">{t("common.summary")}</div>
        <div className="text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <FileText className={cn("size-3.5", ui.varsClassName, ui.textClassName)} aria-hidden="true" />
            <span>{props.configured ? t("common.configured") : t("common.notConfigured")}</span>
          </span>
        </div>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{t("workflows.inputSpec.summaryHint")}</div>
    </div>
  )
}
