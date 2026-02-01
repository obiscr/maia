"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { SectionCard, SectionCardBody, SectionCardHeader } from "@/components/common/section-card"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import { toast } from "@/lib/client/toast"
import { tApiError } from "@/lib/shared/i18n/error"
import { HomeTemplatesSheet } from "@/components/home/sheets/home-templates-sheet"
import { importWorkflowTemplate, type WorkflowTemplateMeta } from "@/lib/client/templates"
import { ItemsList } from "@/components/common/items-list"
import { WorkflowTemplateRow } from "@/components/home/workflow-template-row"

export function HomeGettingStarted(props: { templates: WorkflowTemplateMeta[] }) {
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
          <ItemsList<WorkflowTemplateMeta>
            items={preview}
            getKey={(it) => it.id}
            className="border-0 rounded-none"
            renderItem={(it) => (
              <WorkflowTemplateRow
                template={it}
                importing={importingId === it.id}
                importDisabled={!!importingId}
                onImport={importExample}
              />
            )}
          />
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
