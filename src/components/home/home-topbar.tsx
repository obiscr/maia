"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Bot, BookOpen, Play, PlayIcon, Plus } from "lucide-react"

import { HeaderActions } from "@/components/common/header-actions"
import { ListSearch } from "@/components/common/list-search"
import { useI18n } from "@/components/i18n-provider"
import { toast } from "@/lib/client/toast"
import { tApiError } from "@/lib/shared/i18n/error"
import { fetchWorkflowTemplates, importWorkflowTemplate, type WorkflowTemplateMeta } from "@/lib/client/templates"
import { HomeTemplatesSheet } from "@/components/home/sheets/home-templates-sheet"

export function HomeTopbar() {
  const { t, locale } = useI18n()
  const router = useRouter()
  const [q, setQ] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [templatesOpen, setTemplatesOpen] = React.useState(false)
  const [templatesLoading, setTemplatesLoading] = React.useState(false)
  const [templates, setTemplates] = React.useState<WorkflowTemplateMeta[]>([])
  const [templatesLocale, setTemplatesLocale] = React.useState<string | null>(null)
  const [importingTemplateId, setImportingTemplateId] = React.useState<string | null>(null)
  const templatesInFlightRef = React.useRef<Promise<void> | null>(null)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const next = q.trim()
    if (!next) {
      inputRef.current?.focus()
      return
    }
    const params = new URLSearchParams()
    params.set("q", next)
    router.push(`/runs?${params.toString()}`)
  }

  const loadTemplatesForLocale = React.useCallback(
    async (nextLocale: string) => {
      if (templatesInFlightRef.current) return

      setTemplatesLoading(true)
      const p = (async () => {
        try {
          const list = await fetchWorkflowTemplates()
          setTemplates(list)
          setTemplatesLocale(nextLocale)
        } catch (e) {
          toast.error(tApiError({ t, err: e, fallbackKey: "common.loadFailed" }))
        } finally {
          setTemplatesLoading(false)
          templatesInFlightRef.current = null
        }
      })()

      templatesInFlightRef.current = p
      await p
    },
    [t],
  )

  async function openTemplates() {
    setTemplatesOpen(true)
    if (templatesLoading) return
    if (templates.length && templatesLocale === locale) return
    await loadTemplatesForLocale(locale)
  }

  // Invalidate cached templates when locale changes.
  React.useEffect(() => {
    if (templatesLocale && templatesLocale !== locale) {
      setTemplates([])
      setTemplatesLocale(null)
    }
    // If the sheet is open and we don't have templates for this locale yet, load them.
    if (!templatesOpen) return
    if (templatesLoading) return
    if (templates.length && templatesLocale === locale) return
    void loadTemplatesForLocale(locale)
  }, [locale, loadTemplatesForLocale, templatesLoading, templatesLocale, templatesOpen, templates.length])

  async function importTemplate(id: string) {
    if (importingTemplateId) return
    setImportingTemplateId(id)
    try {
      const { workflowId, needsDepsInstall } = await importWorkflowTemplate(id)
      toast.success(t("workflows.importExport.import.importedToast"))
      if (needsDepsInstall) toast.warning(t("workflows.importExport.import.depsRequiredToast"))
      setTemplatesOpen(false)
      router.push(`/workflows/${workflowId}`)
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
    } finally {
      setImportingTemplateId(null)
    }
  }

  const headerActions = [
    {
      key: "ai",
      label: t("workflows.aiOrchestrateAction"),
      icon: <Bot aria-hidden="true" />,
      href: "/agent",
      pinned: true,
      agent: true,
    },
    {
      key: "newRun",
      label: t("home.quickNewRun"),
      icon: <Play aria-hidden="true" />,
      href: "/jobs?action=new",
      pinned: true,
      variant: "default",
    },
    {
      key: "newWorkflow",
      label: t("home.quickNewWorkflow"),
      icon: <Plus aria-hidden="true" />,
      href: "/workflows?action=new",
      overflowOnly: true,
    },
    {
      key: "templates",
      label: t("home.templatesMenuView"),
      icon: <BookOpen aria-hidden="true" />,
      onClick: () => void openTemplates(),
      overflowOnly: true,
    },
    {
      key: "runs",
      label: t("home.viewAllRuns"),
      icon: <PlayIcon aria-hidden="true" />,
      href: "/runs",
      overflowOnly: true,
    },
  ] as const

  const actionsNode = (
    <HeaderActions
      sections={[
        {
          key: "main",
          items: [...headerActions],
        },
      ]}
      iconOnlyBelow="md"
    />
  )

  return (
    <div className="space-y-2">
      {/* Mobile: actions above search (same as list pages' mobile subbar behavior). */}
      <div className="lg:hidden">{actionsNode}</div>

      <form onSubmit={onSubmit}>
        <ListSearch
          value={q}
          placeholder={t("runs.searchPlaceholder")}
          inputRef={inputRef}
          onChange={(next) => setQ(next)}
          onReset={() => setQ("")}
          desktopRight={actionsNode}
        />
      </form>

      <HomeTemplatesSheet
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        templates={templates}
        loading={templatesLoading}
        importingId={importingTemplateId}
        onImport={importTemplate}
      />
    </div>
  )
}
