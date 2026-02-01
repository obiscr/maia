"use client"

import * as React from "react"

import { ListSearch } from "@/components/common/list-search"
import { useI18n } from "@/components/i18n-provider"
import { cn } from "@/lib/utils"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { HomeTemplatesSheetSkeleton } from "@/components/home/sheets/home-templates-sheet-skeleton"
import { Skeleton } from "@/components/ui/skeleton"
import { ItemsList } from "@/components/common/items-list"
import { WorkflowTemplateRow } from "@/components/home/workflow-template-row"
import type { WorkflowTemplateMeta } from "@/lib/client/templates"

export function HomeTemplatesSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  templates: WorkflowTemplateMeta[]
  loading?: boolean
  importingId: string | null
  onImport: (id: string) => void
}) {
  const { t } = useI18n()
  const { open, onOpenChange, templates, loading = false, importingId, onImport } = props

  const [q, setQ] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  const qNorm = q.trim().toLowerCase()
  const filtered = React.useMemo(() => {
    if (!qNorm) return templates
    return templates.filter((ex) => {
      const hay = `${ex.name}\n${ex.description ?? ""}\n${ex.fileName}`.toLowerCase()
      return hay.includes(qNorm)
    })
  }, [templates, qNorm])

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (importingId) return
        if (!next) setQ("")
        onOpenChange(next)
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col"
        ref={contentRef}
        aria-busy={!!importingId}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
      >
        <SheetHeader>
          <SheetTitle>{t("home.templatesSheetTitle")}</SheetTitle>
          {loading ? (
            <Skeleton className="h-4 w-28" />
          ) : (
            <SheetDescription>{t("home.templatesSheetDescription", { n: templates.length })}</SheetDescription>
          )}
        </SheetHeader>

        <div className="px-4 pt-0">
          <ListSearch
            value={q}
            placeholder={t("home.templatesSearchPlaceholder")}
            inputRef={inputRef}
            onChange={(next) => setQ(next)}
            onReset={() => setQ("")}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4 pt-0">
          {loading ? (
            <HomeTemplatesSheetSkeleton rows={6} />
          ) : (
            <ItemsList<WorkflowTemplateMeta>
              items={filtered}
              getKey={(it) => it.id}
              empty={t("home.templatesNoResults")}
              renderItem={(it) => (
                <WorkflowTemplateRow
                  template={it}
                  importing={importingId === it.id}
                  importDisabled={!!importingId}
                  onImport={onImport}
                />
              )}
            />
          )}
        </div>

        {/* Keep layout stable in case future footer is added */}
        <div className={cn("h-2")} aria-hidden="true" />
      </SheetContent>
    </Sheet>
  )
}
