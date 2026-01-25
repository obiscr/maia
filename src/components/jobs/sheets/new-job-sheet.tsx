"use client"

import { useMemo, useRef, useState } from "react"
import { Braces, Info, PauseCircle, Play, Tag } from "lucide-react"
import type { editor as MonacoEditor } from "monaco-editor"

import { useI18n } from "@/components/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { PageBlocker } from "@/components/ui/page-blocker"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { WorkflowCombobox } from "@/components/common/workflow-combobox"
import { InfoAlert } from "@/components/common/info-alert"
import { ErrorAlert } from "@/components/common/error-alert"
import { useNewJobForm } from "@/components/jobs/hooks/use-new-job-form"
import { ApiIssuesAlert } from "@/components/common/api-issues-alert"
import {
  focusJsonParseErrorInMonacoEditor,
  focusJsonPointerInMonacoEditor,
  normalizeJsonPointer,
} from "@/lib/client/json-pointer"
import { UrlFilesEditor } from "@/components/common/url-files-editor"
import { UploadFilesEditor } from "@/components/common/upload-files-editor"
import { CollapsibleSectionCard } from "@/components/common/collapsible-section-card"
import { JobInputsSkeleton, NewJobSheetSkeleton } from "@/components/jobs/sheets/common-job-sheet-skeleton"
import { JsonMonacoEditor } from "@/components/common/json-monaco-editor"
import { workflowInputSpecHasParams } from "@/lib/shared/maia/input-spec"
import { joinHintParts, workflowFileInputUi } from "@/lib/shared/maia/file-inputs-ui"

export function NewJobSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  redirectTo?: "job" | "run"
}) {
  const { t } = useI18n()

  const contentRef = useRef<HTMLDivElement | null>(null)
  const jsonEditorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const form = useNewJobForm({ t, redirectTo: props.redirectTo })
  const [submitAction, setSubmitAction] = useState<"start" | "create" | null>(null)

  const {
    workflows,
    workflowId,
    setWorkflowId,
    pinnedWorkflowVersionNumber,
    inputSpec,
    inputSpecErr,
    inputSpecLoading,
    schemaProps,
    schemaRequired,
    jsonState,
    inputJson,
    setInputJson,
    urlList,
    urlLines,
    urlMaxItems,
    uploadMaxItems,
    files,
    setFiles,
    submitting,
    canSubmit,
  } = form

  const loading = form.loading
  const uiPending = submitting || submitAction !== null
  const issuesToShow = form.clientValidationIssues ?? []
  const showInputIssues = issuesToShow.length > 0 || form.inputTouched

  const canFormat = jsonState.ok && !!String(inputJson ?? "").trim().length
  function formatJson() {
    const raw = String(inputJson ?? "").trim()
    if (!raw.length) return
    try {
      const parsed = JSON.parse(raw)
      const formatted = JSON.stringify(parsed, null, 2)
      if (formatted === raw) return

      const ed = jsonEditorRef.current
      const focused = !!ed && typeof ed.hasTextFocus === "function" ? ed.hasTextFocus() : false
      const selection = focused && ed ? ed.getSelection() : null
      const scrollTop = focused && ed ? ed.getScrollTop() : null

      setInputJson(formatted)
      if (focused) {
        requestAnimationFrame(() => {
          const ed2 = jsonEditorRef.current
          if (!ed2) return
          if (scrollTop != null) ed2.setScrollTop(scrollTop)
          if (selection) ed2.setSelection(selection)
        })
      }
    } catch {
      // If JSON is invalid, keep current content unchanged.
    }
  }

  const paramsEditorEnabled = useMemo(() => {
    if (!workflowId) return false
    return workflowInputSpecHasParams(inputSpec)
  }, [inputSpec, workflowId])

  const showSelectWorkflowAlert = !workflowId
  const showInputsLoadingSkeleton = !!workflowId && inputSpecLoading
  const urlFilesEnabled = inputSpec?.fileInputs?.urlFiles?.enabled === true
  const uploadsEnabled = inputSpec?.fileInputs?.uploads?.enabled === true
  const showNoInputsAlert =
    !!workflowId && !inputSpecLoading && !inputSpecErr && !paramsEditorEnabled && !urlFilesEnabled && !uploadsEnabled

  const urlFilesUi = useMemo(() => workflowFileInputUi(inputSpec, "urlFiles", t("jobs.urlFiles")), [inputSpec, t])
  const uploadsUi = useMemo(() => workflowFileInputUi(inputSpec, "uploads", t("jobs.uploadFiles")), [inputSpec, t])
  const uploadsHintText = useMemo(() => {
    const mime = inputSpec?.fileInputs?.uploads?.acceptMime?.length
      ? inputSpec.fileInputs.uploads.acceptMime.join(", ")
      : ""
    return joinHintParts([uploadsUi.description, mime])
  }, [inputSpec?.fileInputs?.uploads?.acceptMime, uploadsUi.description])

  function submit(action: "start" | "create") {
    const start = action === "start"
    setSubmitAction(action)
    void form.createJob({ start }).then((r) => {
      if (!r?.started) setSubmitAction(null)
    })
  }

  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (uiPending) return
        if (!open) setSubmitAction(null)
        props.onOpenChange(open)
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl flex flex-col"
        ref={contentRef}
        aria-busy={uiPending}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          requestAnimationFrame(() => {
            const root = contentRef.current
            if (!root) return
            const first =
              (root.querySelector(
                "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
              ) as HTMLElement | null) ?? null
            first?.focus()
          })
        }}
      >
        {/* When submitting, disable the entire page immediately (we redirect after success, so no need to restore). */}
        <PageBlocker active={uiPending} />

        <SheetHeader>
          <SheetTitle>{t("jobs.startTitle")}</SheetTitle>
          <SheetDescription>{t("jobs.startDescription")}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <NewJobSheetSkeleton t={t} />
          ) : workflows.length === 0 ? (
            <div className="px-4 pb-4">
              <Alert className="rounded-md">
                <Info aria-hidden="true" />
                <AlertTitle>{t("common.workflowRequiredTitle")}</AlertTitle>
                <AlertDescription>{t("common.workflowRequiredDescription")}</AlertDescription>
              </Alert>
            </div>
          ) : (
            <div className="space-y-3 px-4 pb-4">
              <CollapsibleSectionCard
                title={t("jobs.selectWorkflowTitle")}
                icon={<span className="text-muted-foreground">①</span>}
                defaultOpen
                bodyClassName="p-4"
                toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
              >
                <FieldGroup className="gap-3">
                  <Field>
                    <div className="flex items-center justify-between gap-2">
                      <FieldLabel>{t("common.entities.workflow")}</FieldLabel>
                      {typeof pinnedWorkflowVersionNumber === "number" ? (
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                          title={t("jobs.pinnedWorkflowVersionTooltip", { version: pinnedWorkflowVersionNumber })}
                        >
                          <span className="inline-flex items-center gap-1">
                            <Tag className="size-3" aria-hidden={true} />
                            <span>
                              {t("jobs.pinnedWorkflowVersionBadge", { version: pinnedWorkflowVersionNumber })}
                            </span>
                          </span>
                        </Badge>
                      ) : null}
                    </div>
                    <WorkflowCombobox
                      items={workflows.map((w) => ({ id: w.id, name: w.name }))}
                      value={workflowId}
                      onValueChange={setWorkflowId}
                      disabled={uiPending}
                      placeholder={t("jobs.selectWorkflow")}
                      searchPlaceholder={t("common.workflowCombobox.searchPlaceholder")}
                      emptyText={t("common.workflowCombobox.empty")}
                    />
                  </Field>
                </FieldGroup>
              </CollapsibleSectionCard>

              <CollapsibleSectionCard
                title={t("common.inputParams")}
                icon={<span className="text-muted-foreground">②</span>}
                defaultOpen
                bodyClassName="p-4"
                toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
              >
                {showSelectWorkflowAlert ? (
                  <InfoAlert
                    titleKey="common.selectWorkflowForInputsTitle"
                    descriptionKey="common.selectWorkflowForInputsDescription"
                  />
                ) : showInputsLoadingSkeleton ? (
                  <JobInputsSkeleton />
                ) : inputSpecErr ? (
                  <ErrorAlert titleKey="jobs.inputSpecInvalid" description={inputSpecErr} />
                ) : !inputSpec ? (
                  <InfoAlert titleKey="common.noInputsTitle" descriptionKey="common.inputSpecMissingHint" />
                ) : showNoInputsAlert ? (
                  <InfoAlert titleKey="common.noInputsTitle" descriptionKey="common.noInputsDescription" />
                ) : (
                  <div className="grid gap-4">
                    {showInputIssues && issuesToShow.length ? (
                      <ApiIssuesAlert
                        title={t("errors.INVALID_INITIAL_INPUT")}
                        issues={issuesToShow}
                        onIssueClick={(iss) => {
                          const ed = jsonEditorRef.current
                          if (String(iss.keyword ?? "") === "json") {
                            focusJsonParseErrorInMonacoEditor(ed, iss.message)
                            return
                          }
                          const p = normalizeJsonPointer(iss.path)
                          focusJsonPointerInMonacoEditor(ed, p)
                        }}
                      />
                    ) : null}

                    {/* Input JSON template */}
                    {paramsEditorEnabled ? (
                      <JsonMonacoEditor
                        title={t("common.inputTemplate")}
                        required={schemaRequired.length > 0}
                        codeLabel="inputJson"
                        editorRef={jsonEditorRef}
                        value={inputJson}
                        onChange={setInputJson}
                        height={400}
                        disabled={uiPending}
                        actions={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="h-6 w-6"
                            onClick={formatJson}
                            disabled={uiPending || !canFormat}
                            aria-label={t("workflows.inputSpec.formatAction")}
                            title={t("workflows.inputSpec.formatAction")}
                          >
                            <Braces className="size-4" />
                          </Button>
                        }
                        showActionsOnHover
                      />
                    ) : null}

                    {/* File inputs (URLs + uploads) */}
                    {urlFilesEnabled ? (
                      <div className="space-y-3">
                        <UrlFilesEditor
                          title={urlFilesUi.title}
                          required={inputSpec?.fileInputs?.urlFiles?.required === true}
                          codeLabel="urlFiles"
                          hintText={urlFilesUi.description}
                          rightSlot={
                            typeof inputSpec?.fileInputs?.urlFiles?.maxItems === "number" ? (
                              <Badge variant="outline" className="text-[10px]">
                                {t("jobs.limitCount", {
                                  count: urlLines.length,
                                  max: inputSpec.fileInputs.urlFiles.maxItems,
                                })}
                              </Badge>
                            ) : null
                          }
                          value={urlList}
                          onChange={(raw) => form.onUrlListChange(raw)}
                          rows={4}
                          placeholder={"https://example.com/data.csv\nhttps://example.com/image.png"}
                          disabled={uiPending}
                          headerClassName="flex items-start justify-between gap-3"
                          textareaClassName="font-mono text-xs"
                        />
                      </div>
                    ) : null}

                    {uploadsEnabled ? (
                      <div className="space-y-3">
                        <UploadFilesEditor
                          title={uploadsUi.title}
                          required={inputSpec?.fileInputs?.uploads?.required === true}
                          codeLabel="uploads"
                          hintText={uploadsHintText}
                          rightSlot={
                            typeof inputSpec?.fileInputs?.uploads?.maxItems === "number" ? (
                              <Badge variant="outline" className="text-[10px]">
                                {t("jobs.limitCount", {
                                  count: files.length,
                                  max: inputSpec.fileInputs.uploads.maxItems,
                                })}
                              </Badge>
                            ) : null
                          }
                          files={files}
                          onPickFiles={form.onPickFiles}
                          onRemoveFileAt={(idx) => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                          accept={
                            inputSpec?.fileInputs?.uploads?.acceptMime?.length
                              ? inputSpec.fileInputs.uploads.acceptMime.join(",")
                              : undefined
                          }
                          disabled={uiPending}
                          disablePick={typeof uploadMaxItems === "number" ? files.length >= uploadMaxItems : false}
                        />
                      </div>
                    ) : null}
                  </div>
                )}
              </CollapsibleSectionCard>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t p-4">
          <div className="flex flex-col gap-2">
            <Button size="sm" className="w-full" onClick={() => submit("start")} disabled={!canSubmit || uiPending}>
              {uiPending && submitAction === "start" ? <Spinner className="size-6" /> : <Play />}
              {t("jobs.enqueueNowAction")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => submit("create")}
              disabled={!canSubmit || uiPending}
            >
              {uiPending && submitAction === "create" ? <Spinner className="size-6" /> : <PauseCircle />}
              {t("jobs.createOnlyAction")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
