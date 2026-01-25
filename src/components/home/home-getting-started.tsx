"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Download, Package } from "lucide-react"

import { SectionCard, SectionCardBody, SectionCardHeader } from "@/components/common/section-card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { useI18n } from "@/components/i18n-provider"
import { toast } from "@/lib/client/toast"
import { tApiError } from "@/lib/shared/i18n/error"
import { HomeTemplatesSheet, type HomeWorkflowTemplateMeta } from "@/components/home/sheets/home-templates-sheet"
import { importWorkflowTemplate } from "@/lib/client/templates"

export function HomeGettingStarted(props: { templates: HomeWorkflowTemplateMeta[] }) {
  const { t } = useI18n()
  const router = useRouter()
  const [importingId, setImportingId] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)

  const PREVIEW_COUNT = 8
  const preview = props.templates.slice(0, PREVIEW_COUNT)

  async function importExample(id: string) {
    if (importingId) return
    setImportingId(id)
    try {
      const { workflowId, needsDepsInstall } = await importWorkflowTemplate(id)
      toast.success(t("workflows.importExport.import.importedToast"))
      if (needsDepsInstall) toast.warning(t("workflows.importExport.import.depsRequiredToast"))
      router.push(`/workflows/${workflowId}`)
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
    } finally {
      setImportingId(null)
    }
  }

  return (
    <SectionCard>
      <SectionCardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">{t("home.templatesTitle")}</div>
            <div className="text-xs text-muted-foreground">{t("home.templatesDescription")}</div>
          </div>
          {props.templates.length > PREVIEW_COUNT ? (
            <Button
              size="sm"
              variant="ghost"
              className="-mr-2"
              onClick={() => {
                setOpen(true)
              }}
            >
              {t("home.templatesViewMore", { n: props.templates.length })}
            </Button>
          ) : null}
        </div>
      </SectionCardHeader>
      <SectionCardBody>
        {props.templates.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">{t("home.templatesEmpty")}</div>
        ) : (
          <div className="divide-y">
            {preview.map((ex) => {
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
                    onClick={() => importExample(ex.id)}
                    disabled={!!importingId}
                    className="shrink-0"
                  >
                    {isImporting ? (
                      <Spinner className="mr-2" />
                    ) : (
                      <Download className="mr-2 size-4" aria-hidden="true" />
                    )}
                    {isImporting
                      ? t("workflows.importExport.import.importing")
                      : t("workflows.importExport.import.importAction")}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </SectionCardBody>

      <HomeTemplatesSheet
        open={open}
        onOpenChange={setOpen}
        templates={props.templates}
        loading={false}
        importingId={importingId}
        onImport={importExample}
      />
    </SectionCard>
  )
}
