"use client"

import { useI18n } from "@/components/i18n-provider"
import { FileText, TriangleAlertIcon } from "lucide-react"

export function WorkflowInputSpecSummaryCard(props: { configured: boolean }) {
  const { t } = useI18n()

  return (
    <div className="rounded-md border bg-muted/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">{t("common.summary")}</div>
        <div className="text-xs text-muted-foreground">
          {props.configured ? (
            <span className="inline-flex items-center gap-1">
              <FileText className="size-3.5 text-emerald-500" aria-hidden="true" />
              <span>{t("common.configured")}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <span className="maia-status-badge--pending inline-flex items-center">
                <TriangleAlertIcon className="size-3.5 text-[color:var(--maia-status-text)]" aria-hidden="true" />
              </span>
              <span>{t("common.notConfigured")}</span>
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{t("workflows.inputSpec.summaryHint")}</div>
    </div>
  )
}
