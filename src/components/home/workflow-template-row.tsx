"use client"

import { Download, Package } from "lucide-react"

import { CommonListItem } from "@/components/common/common-list-item"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { useI18n } from "@/components/i18n-provider"
import type { WorkflowTemplateMeta } from "@/lib/client/templates"

export function WorkflowTemplateRow(props: {
  template: WorkflowTemplateMeta
  importing: boolean
  importDisabled: boolean
  onImport: (id: string) => void
}) {
  const { t } = useI18n()
  const { template: ex } = props

  const leftColumn = (
    <ItemContent className="min-w-0">
      <ItemTitle className="w-full min-w-0 text-base leading-snug">
        <span className="font-medium text-sm truncate block">{ex.name}</span>
      </ItemTitle>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{t("workflows.versions.stepsCount", { n: ex.stepCount })}</Badge>
        {ex.depsCount > 0 ? (
          <Badge variant="outline" className="gap-1">
            <Package className="size-3.5" aria-hidden="true" />
            <span>{t("workflows.versions.depsCount", { n: ex.depsCount })}</span>
          </Badge>
        ) : null}
      </div>

      {ex.description ? (
        <ItemDescription className="mt-1 line-clamp-2 text-xs">{ex.description}</ItemDescription>
      ) : null}
    </ItemContent>
  )

  const actions = (
    <Button
      size="sm"
      variant="default"
      onClick={() => props.onImport(ex.id)}
      disabled={props.importDisabled}
      className="shrink-0"
    >
      {props.importing ? <Spinner className="mr-2" /> : <Download className="mr-2 size-4" aria-hidden="true" />}
      {props.importing ? t("workflows.importExport.import.importing") : t("workflows.importExport.import.importAction")}
    </Button>
  )

  return <CommonListItem columns={[{ key: "left", content: leftColumn, showOnMobile: true }]} actions={actions} />
}
