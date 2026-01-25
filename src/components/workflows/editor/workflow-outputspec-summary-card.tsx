"use client"

import * as React from "react"

import { useI18n } from "@/components/i18n-provider"
import { Badge } from "@/components/ui/badge"

export function WorkflowOutputsSpecSummaryCard(props: { configured: boolean }) {
  const { t } = useI18n()
  return (
    <div className="rounded-md border p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="text-muted-foreground">{t("workflows.outputsSpec.summaryHint")}</div>
        <Badge variant={props.configured ? "secondary" : "outline"} className="h-5 px-2 text-[11px]">
          {props.configured ? t("common.configured") : t("workflows.outputsSpec.none")}
        </Badge>
      </div>
    </div>
  )
}
