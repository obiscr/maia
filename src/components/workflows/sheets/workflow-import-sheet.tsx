"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircleIcon,
  Boxes,
  Download,
  Eye,
  EyeOff,
  FileText,
  IdCard,
  KeyRound,
  ListTree,
  Package,
  PackagePlus,
  X,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { SecretInput } from "@/components/ui/secret-input"
import { PageBlocker } from "@/components/ui/page-blocker"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CollapsibleSectionCard } from "@/components/common/collapsible-section-card"
import { JsonViewer } from "@/components/common/json-viewer"
import { useI18n } from "@/components/i18n-provider"
import { WorkflowStepsCodePreview } from "@/components/workflows/common/workflow-steps-code-preview"
import { toast } from "@/lib/client/toast"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"
import {
  workflowExportV1Schema,
  workflowExportV1ToCreateWorkflowPayload,
  type WorkflowExportV1,
} from "@/lib/shared/workflow-import-export"

type ParsedDeps = Array<{ name: string; version: string }>

function depsRows(deps: Record<string, string>) {
  return Object.entries(deps ?? {})
    .map(([name, version]) => ({ name, version }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function envRows(env: Record<string, string>) {
  return Object.entries(env ?? {})
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

export function WorkflowImportSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Optional: after successful import, close the sheet automatically. Default: true */
  closeOnSuccess?: boolean
}) {
  const { t } = useI18n()
  const router = useRouter()

  const closeOnSuccess = props.closeOnSuccess ?? true

  const [fileName, setFileName] = React.useState<string>("")
  const [rawText, setRawText] = React.useState<string>("")
  const [parseErr, setParseErr] = React.useState<string | null>(null)
  const [exp, setExp] = React.useState<WorkflowExportV1 | null>(null)
  const [importing, setImporting] = React.useState(false)
  const [visibleEnvKeys, setVisibleEnvKeys] = React.useState<Set<string>>(() => new Set())

  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (!props.open) return
    setFileName("")
    setRawText("")
    setParseErr(null)
    setExp(null)
    setVisibleEnvKeys(new Set())
    setImporting(false)
  }, [props.open])

  const deps = React.useMemo<ParsedDeps>(() => (exp ? depsRows(exp.data.dependencies) : []), [exp])
  const env = React.useMemo(() => (exp ? envRows(exp.data.env) : []), [exp])

  async function onPickFile(f: File | null) {
    setParseErr(null)
    setExp(null)
    setVisibleEnvKeys(new Set())
    if (!f) return
    // Note: browsers do not expose the real local file path for security reasons.
    // `webkitRelativePath` is set when selecting a directory (or when using directory upload).
    setFileName((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name || "")
    try {
      const txt = await f.text()
      setRawText(txt)
      const parsedJson = JSON.parse(txt)
      const parsed = workflowExportV1Schema.safeParse(parsedJson)
      if (!parsed.success) {
        setParseErr(t("workflows.importExport.import.invalidFileDescription"))
        return
      }
      setExp(parsed.data)
    } catch (e) {
      setParseErr(e instanceof Error ? e.message : String(e))
    }
  }

  function openFilePicker() {
    if (importing) return
    const el = fileInputRef.current
    if (!el) return
    // Allow re-selecting the same file and still triggering onChange.
    el.value = ""
    el.click()
  }

  async function doImport() {
    if (!exp || importing) return
    setImporting(true)
    setParseErr(null)
    try {
      const depsCount = Object.keys(exp.data.dependencies ?? {}).length
      const needsDepsInstall = depsCount > 0
      const payload = workflowExportV1ToCreateWorkflowPayload(exp)
      const json = await apiFetchJson<{ workflow?: { id: string } }>("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const newId = String(json.workflow?.id ?? "")
      if (!newId) throw new Error("Missing workflow id")
      toast.success(t("workflows.importExport.import.importedToast"))
      if (needsDepsInstall) toast.warning(t("workflows.importExport.import.depsRequiredToast"))
      if (closeOnSuccess) props.onOpenChange(false)
      router.push(`/workflows/${newId}`)
      setImporting(false)
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
      setImporting(false)
    }
  }

  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (importing) return
        props.onOpenChange(open)
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl flex flex-col"
        ref={contentRef}
        aria-busy={importing}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          requestAnimationFrame(() => {
            const root = contentRef.current
            if (!root) return
            const first = (root.querySelector("input:not([disabled])") as HTMLElement | null) ?? null
            first?.focus()
          })
        }}
      >
        <PageBlocker active={importing} />
        <form
          className="contents"
          onSubmit={(e) => {
            // This sheet uses explicit buttons; prevent accidental submit on Enter.
            e.preventDefault()
          }}
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Download className="size-4" aria-hidden="true" />
              {t("workflows.importExport.import.title")}
            </SheetTitle>
            <SheetDescription>{t("workflows.importExport.import.description")}</SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-auto p-4 pt-0 space-y-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="wf-import-file">{t("workflows.importExport.import.fileLabel")}</FieldLabel>
                <div className="relative">
                  <Input
                    readOnly
                    value={fileName}
                    placeholder={t("workflows.importExport.import.filePlaceholder")}
                    disabled={importing}
                    onClick={openFilePicker}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={importing}
                    onClick={openFilePicker}
                    className="absolute right-1 top-1/2 -translate-y-1/2 bg-transparent hover:bg-transparent focus-visible:ring-0"
                    aria-label={t("workflows.importExport.import.browseButton")}
                  >
                    <Download className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <input
                  id="wf-import-file"
                  type="file"
                  accept="application/json,.json"
                  disabled={importing}
                  tabIndex={-1}
                  className="sr-only"
                  ref={fileInputRef}
                  onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
                />
              </Field>
            </FieldGroup>

            {parseErr ? (
              <Alert variant="destructive">
                <AlertCircleIcon className="size-4" />
                <AlertTitle>{t("workflows.importExport.import.invalidFileTitle")}</AlertTitle>
                <AlertDescription className="break-words">{parseErr}</AlertDescription>
              </Alert>
            ) : null}

            {exp ? (
              <div className="space-y-3">
                <CollapsibleSectionCard
                  title={t("workflows.meta.title")}
                  icon={<IdCard className="size-3.5" aria-hidden="true" />}
                  defaultOpen
                  bodyClassName="p-4"
                  toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
                >
                  <div className="grid gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">{t("workflows.importExport.labels.workflowId")}：</span>
                      <span className="font-mono">{exp.workflow.id}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t("workflows.name")}：</span>
                      <span>{exp.data.meta.name}</span>
                    </div>
                    {exp.version?.description ? (
                      <div>
                        <span className="text-muted-foreground">{t("common.note")}：</span>
                        <span className="whitespace-pre-wrap">{exp.version.description}</span>
                      </div>
                    ) : null}
                    {exp.data.meta.description ? (
                      <div>
                        <span className="text-muted-foreground">
                          {t("workflows.importExport.labels.description")}：
                        </span>
                        <span className="whitespace-pre-wrap">{exp.data.meta.description}</span>
                      </div>
                    ) : null}
                    <div>
                      <span className="text-muted-foreground">{t("workflows.importExport.labels.exportedAt")}：</span>
                      <span className="font-mono">{exp.exportedAt}</span>
                      {exp.flags?.envIncluded ? (
                        <span className="ml-2 text-amber-600">
                          {t("workflows.importExport.export.includeEnvTitle")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </CollapsibleSectionCard>

                <CollapsibleSectionCard
                  title={t("common.steps")}
                  icon={<ListTree className="size-3.5" aria-hidden="true" />}
                  bodyClassName="p-0"
                  toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
                >
                  <div className="h-[60vh] max-h-[520px] min-h-[380px] overflow-hidden">
                    <WorkflowStepsCodePreview
                      className="h-full min-h-0"
                      layout="mobile"
                      steps={exp.data.steps.map((s) => ({
                        stepKey: s.stepKey,
                        name: s.name,
                        timeoutMs: s.timeoutMs,
                        scriptEsm: s.scriptEsm ?? "",
                      }))}
                      emptyText={t("workflows.importExport.empty.noSteps")}
                    />
                  </div>
                </CollapsibleSectionCard>

                <CollapsibleSectionCard
                  title={t("workflows.env.title")}
                  icon={<KeyRound className="size-3.5" aria-hidden="true" />}
                  bodyClassName="p-0"
                  toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
                >
                  {env.length ? (
                    <Table className="w-full table-fixed">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-1/2">{t("workflows.env.columns.key")}</TableHead>
                          <TableHead className="w-1/2">{t("workflows.env.columns.value")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {env.map((r) => {
                          const visible = visibleEnvKeys.has(r.key)
                          return (
                            <TableRow key={r.key}>
                              <TableCell className="min-w-0 w-1/2">
                                <Input value={r.key} readOnly className="h-8 w-full min-w-[120px] font-mono text-xs" />
                              </TableCell>
                              <TableCell className="min-w-0 w-1/2">
                                <div className="relative">
                                  <SecretInput
                                    value={r.value}
                                    readOnly
                                    masked={!visible}
                                    className="h-8 w-full min-w-[160px] pr-10 font-mono text-xs"
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="absolute right-1 top-1/2 -translate-y-1/2 bg-transparent hover:bg-transparent focus-visible:ring-0"
                                    onClick={() => {
                                      setVisibleEnvKeys((prev) => {
                                        const n = new Set(prev)
                                        if (n.has(r.key)) n.delete(r.key)
                                        else n.add(r.key)
                                        return n
                                      })
                                    }}
                                    aria-label={
                                      visible
                                        ? t("workflows.env.actions.hideValue")
                                        : t("workflows.env.actions.showValue")
                                    }
                                  >
                                    {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="p-1 text-xs p-4">
                      {exp.flags?.envIncluded ? t("workflows.env.empty") : t("common.notConfigured")}
                    </div>
                  )}
                </CollapsibleSectionCard>

                <CollapsibleSectionCard
                  title={t("workflows.dependencies")}
                  icon={<Package className="size-3.5" aria-hidden="true" />}
                  bodyClassName="p-0"
                  toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
                >
                  {deps.length ? (
                    <Table className="w-full table-fixed">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-1/2">{t("workflows.deps.columns.name")}</TableHead>
                          <TableHead className="w-1/2">{t("workflows.deps.columns.version")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {deps.map((r) => (
                          <TableRow key={r.name}>
                            <TableCell className="min-w-0 w-1/2">
                              <Input value={r.name} readOnly className="h-8 w-full min-w-[120px] font-mono text-xs" />
                            </TableCell>
                            <TableCell className="min-w-0 w-1/2">
                              <Input
                                value={r.version}
                                readOnly
                                className="h-8 w-full min-w-[120px] font-mono text-xs"
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="p-1 text-xs p-4">{t("workflows.deps.empty")}</div>
                  )}
                </CollapsibleSectionCard>

                <CollapsibleSectionCard
                  title={t("workflows.inputSpec.title")}
                  icon={<FileText className="size-3.5" aria-hidden="true" />}
                  bodyClassName="p-0"
                  toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
                >
                  <JsonViewer value={exp.data.inputSpec ?? null} />
                </CollapsibleSectionCard>

                <CollapsibleSectionCard
                  title={t("workflows.outputsSpec.title")}
                  icon={<Boxes className="size-3.5" aria-hidden="true" />}
                  bodyClassName="p-0"
                  toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
                >
                  <JsonViewer value={exp.data.outputsSpec ?? null} />
                </CollapsibleSectionCard>
              </div>
            ) : null}
          </div>

          <SheetFooter className="border-t bg-background">
            <div className="flex flex-col gap-2">
              <Button size="sm" onClick={() => void doImport()} disabled={!exp || importing}>
                {importing ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" aria-hidden="true" />}
                {importing
                  ? t("workflows.importExport.import.importing")
                  : t("workflows.importExport.import.importAction")}
              </Button>
              <SheetClose asChild>
                <Button size="sm" variant="outline" disabled={importing}>
                  <X aria-hidden="true" />
                  {t("common.cancelAction")}
                </Button>
              </SheetClose>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
