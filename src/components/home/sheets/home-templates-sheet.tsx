"use client"

import * as React from "react"
import { Download, Package } from "lucide-react"

import { ListSearch } from "@/components/common/list-search"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import { cn } from "@/lib/utils"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { HomeTemplatesSheetSkeleton } from "@/components/home/sheets/home-templates-sheet-skeleton"
import { Skeleton } from "@/components/ui/skeleton"

export type HomeWorkflowTemplateMeta = {
  id: string
  fileName: string
  name: string
  description: string | null
  stepCount: number
  depsCount: number
}

export function HomeTemplatesSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  templates: HomeWorkflowTemplateMeta[]
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
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">{t("home.templatesNoResults")}</div>
          ) : (
            <div className="divide-y rounded-md border">
              {filtered.map((ex) => {
                const isImporting = importingId === ex.id
                return (
                  <div key={ex.id} className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-sm truncate">{ex.name}</div>
                        <Badge variant="secondary">{t("workflows.versions.stepsCount", { n: ex.stepCount })}</Badge>
                        {ex.depsCount > 0 ? (
                          <Badge variant="outline" className="gap-1">
                            <Package className="size-3.5" aria-hidden="true" />
                            <span>{t("workflows.versions.depsCount", { n: ex.depsCount })}</span>
                          </Badge>
                        ) : null}
                      </div>
                      {ex.description ? (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{ex.description}</div>
                      ) : null}
                    </div>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => onImport(ex.id)}
                      disabled={!!importingId}
                      className="shrink-0"
                    >
                      <Download className="mr-2 size-4" aria-hidden="true" />
                      {isImporting
                        ? t("workflows.importExport.import.importing")
                        : t("workflows.importExport.import.importAction")}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Keep layout stable in case future footer is added */}
        <div className={cn("h-2")} aria-hidden="true" />
      </SheetContent>
    </Sheet>
  )
}
