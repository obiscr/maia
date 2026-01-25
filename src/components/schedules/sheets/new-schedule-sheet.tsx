"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Braces, Info, Plus, X } from "lucide-react"
import type { editor as MonacoEditor } from "monaco-editor"

import { useI18n } from "@/components/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PageBlocker } from "@/components/ui/page-blocker"
import { WorkflowCombobox } from "@/components/common/workflow-combobox"
import { TimezoneCombobox } from "@/components/common/timezone-combobox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useNewScheduleForm } from "@/components/schedules/hooks/use-new-schedule-form"
import { apiFetchJson } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"
import { tApiError, tError } from "@/lib/shared/i18n/error"
import { FieldLabelWithHelp } from "@/components/common/field-label-with-help"
import { CollapsibleSectionCard } from "@/components/common/collapsible-section-card"
import { Badge } from "@/components/ui/badge"
import { ScheduleInputsSkeleton, SheetSkeleton } from "./common-schedule-sheet-skeleton"
import { ApiIssuesAlert } from "@/components/common/api-issues-alert"
import { InfoAlert } from "@/components/common/info-alert"
import { ErrorAlert } from "@/components/common/error-alert"
import {
  focusJsonParseErrorInMonacoEditor,
  focusJsonPointerInMonacoEditor,
  normalizeJsonPointer,
} from "@/lib/client/json-pointer"
import { UrlFilesEditor } from "@/components/common/url-files-editor"
import { JsonMonacoEditor } from "@/components/common/json-monaco-editor"
import { workflowInputSpecHasParams } from "@/lib/shared/maia/input-spec"
import { workflowFileInputUi } from "@/lib/shared/maia/file-inputs-ui"

function toScheduleKind(v: string): "CRON" | "INTERVAL" {
  return v === "INTERVAL" ? "INTERVAL" : "CRON"
}

export function NewScheduleSheet(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const inputJsonEditorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const form = useNewScheduleForm({ t })
  const [enabled, setEnabled] = useState(true)

  const misfireHintKeyByPolicy: Record<"SKIP" | "FIRE_ONCE" | "CATCH_UP", string> = {
    FIRE_ONCE: "schedules.policies.misfireHint.FIRE_ONCE",
    SKIP: "schedules.policies.misfireHint.SKIP",
    CATCH_UP: "schedules.policies.misfireHint.CATCH_UP",
  }

  const overlapHintKeyByPolicy: Record<"SKIP" | "ALLOW", string> = {
    SKIP: "schedules.policies.overlapHint.SKIP",
    ALLOW: "schedules.policies.overlapHint.ALLOW",
  }

  const {
    workflows,
    workflowId,
    setWorkflowId,
    name,
    setName,
    kind,
    setKind,
    cron,
    setCron,
    timezone,
    setTimezone,
    intervalMs,
    setIntervalMs,
    misfirePolicy,
    setMisfirePolicy,
    catchUpLimit,
    setCatchUpLimit,
    overlapPolicy,
    setOverlapPolicy,
    pinnedMode,
    setPinnedMode,
    pinnedWorkflowVersionNumber,
    setPinnedWorkflowVersionNumber,
    inputJsonRaw,
    setInputJsonRaw,
    inputTouched,
    jsonState,
    inputJsonOk,
    inputJsonErr,
    urlList,
    onUrlListChange,
    urlLines,
    urlMaxItems,
    inputSpec,
    inputSpecErr,
    inputSpecLoading,
    schemaProps,
    schemaRequired,
    clientValidationIssues,
    submitError,
    submitting,
    canSubmit,
    workflowHasInputSpec,
  } = form
  const loading = form.loading
  const uiPending = submitting

  const misfireHintKey = misfireHintKeyByPolicy[misfirePolicy]
  const overlapHintKey = overlapHintKeyByPolicy[overlapPolicy]

  const paramsEditorEnabled = useMemo(() => {
    if (!workflowId) return false
    return workflowInputSpecHasParams(inputSpec)
  }, [inputSpec, workflowId])

  const showSelectWorkflowAlert = !workflowId
  const urlFilesEnabled = inputSpec?.fileInputs?.urlFiles?.enabled === true
  const showNoInputsAlert = !!workflowId && !inputSpecLoading && !paramsEditorEnabled && !urlFilesEnabled
  const showInputsLoadingSkeleton = !!workflowId && inputSpecLoading

  const urlFilesUi = useMemo(() => workflowFileInputUi(inputSpec, "urlFiles", t("jobs.urlFiles")), [inputSpec, t])

  const issuesToShow = submitError?.issues?.length ? submitError.issues : clientValidationIssues
  const showInputIssues =
    !!submitError ||
    (workflowId && workflowHasInputSpec && !inputSpecLoading && issuesToShow.length > 0) ||
    inputTouched
  const issuesTitle = tError({
    t,
    code: submitError?.code ?? "INVALID_INPUT_JSON",
    fallbackKey: "common.error",
  })

  const canFormat = inputJsonOk && !!String(inputJsonRaw ?? "").trim().length
  function formatJson() {
    const raw = String(inputJsonRaw ?? "").trim()
    if (!raw.length) return
    try {
      const parsed = JSON.parse(raw)
      const formatted = JSON.stringify(parsed, null, 2)
      if (formatted === raw) return

      const ed = inputJsonEditorRef.current
      const focused = !!ed && typeof ed.hasTextFocus === "function" ? ed.hasTextFocus() : false
      const selection = focused && ed ? ed.getSelection() : null
      const scrollTop = focused && ed ? ed.getScrollTop() : null

      setInputJsonRaw(formatted)
      if (focused) {
        requestAnimationFrame(() => {
          const ed2 = inputJsonEditorRef.current
          if (!ed2) return
          if (scrollTop != null) ed2.setScrollTop(scrollTop)
          if (selection) ed2.setSelection(selection)
        })
      }
    } catch {
      // If JSON is invalid, keep current content unchanged.
    }
  }

  // When we have server-side issues after submit, scroll inputs into view.
  useEffect(() => {
    if (!submitError) return
    requestAnimationFrame(() => {
      const ed = inputJsonEditorRef.current
      if (!ed) return
      const node = typeof ed.getDomNode === "function" ? ed.getDomNode() : null
      node?.scrollIntoView({ behavior: "smooth", block: "center" })
      ed.focus()
    })
  }, [submitError])

  function submit() {
    void form.createSchedule({ enabled })
  }

  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versions, setVersions] = useState<Array<{ version: number; createdAt: string; description: string | null }>>(
    [],
  )
  // We fetch versions as soon as a workflow is selected (and sheet is open),
  // so LATEST mode can still display the real latest version number.
  const versionsEnabled = props.open && !!workflowId
  const latestVersion = versions.length ? versions[0]!.version : null

  useEffect(() => {
    if (!versionsEnabled) return
    let cancelled = false
    setVersionsLoading(true)
    void (async () => {
      try {
        const params = new URLSearchParams()
        params.set("page", "1")
        params.set("pageSize", "20")
        params.set("sort", "CREATED_DESC")
        const j = await apiFetchJson<{
          versions?: Array<{ version: number; createdAt: string; description: string | null }>
        }>(`/api/workflows/${encodeURIComponent(workflowId)}/versions?${params.toString()}`, { cache: "no-store" })
        if (cancelled) return
        const rows = Array.isArray(j?.versions) ? j.versions : []
        setVersions(
          rows
            .filter(
              (v): v is { version: number; createdAt: string; description: string | null } =>
                typeof v?.version === "number",
            )
            .map((v) => ({
              version: v.version,
              createdAt: String(v.createdAt ?? ""),
              description: v.description ?? null,
            })),
        )
      } catch (e) {
        if (cancelled) return
        toast.error(tApiError({ t, err: e, fallbackKey: "common.loadFailed" }))
        setVersions([])
      } finally {
        if (!cancelled) setVersionsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [t, workflowId, versionsEnabled])

  // UX: when switching to PINNED, default to the latest version once loaded.
  useEffect(() => {
    if (!versionsEnabled) return
    if (pinnedMode !== "PINNED") return
    if (typeof pinnedWorkflowVersionNumber === "number") return
    if (versionsLoading) return
    if (!versions.length) return
    setPinnedWorkflowVersionNumber(versions[0]!.version)
  }, [
    pinnedMode,
    pinnedWorkflowVersionNumber,
    setPinnedWorkflowVersionNumber,
    versions,
    versionsEnabled,
    versionsLoading,
  ])

  const versionSelectValue = useMemo(() => {
    return typeof pinnedWorkflowVersionNumber === "number" ? String(pinnedWorkflowVersionNumber) : ""
  }, [pinnedWorkflowVersionNumber])

  function PinnedWorkflowVersionControls() {
    return (
      <div className="grid gap-2">
        <FieldLabelWithHelp
          label={t("common.pinnedWorkflowVersion")}
          tooltip={t("schedules.policies.pinnedHint")}
          htmlFor="schedule-new-pinned-mode"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <Select
            value={pinnedMode}
            onValueChange={(v) => setPinnedMode(v as "LATEST" | "PINNED")}
            disabled={uiPending}
          >
            <SelectTrigger id="schedule-new-pinned-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="LATEST">{t("schedules.policies.pinnedMode.latest")}</SelectItem>
              <SelectItem value="PINNED">{t("schedules.policies.pinnedMode.pinned")}</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={
              pinnedMode === "PINNED"
                ? versionSelectValue || "__none"
                : latestVersion != null
                  ? String(latestVersion)
                  : "__none"
            }
            onValueChange={(v) => {
              if (v === "__none") setPinnedWorkflowVersionNumber(null)
              else setPinnedWorkflowVersionNumber(Number(v))
            }}
            disabled={uiPending || pinnedMode !== "PINNED" || versionsLoading || versions.length === 0}
          >
            <SelectTrigger id="schedule-new-pinned-version" className="w-full">
              <SelectValue placeholder={t("schedules.policies.pinnedSelectPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {versions.length === 0 ? (
                <SelectItem value="__none" disabled>
                  {t("schedules.policies.pinnedNoVersions")}
                </SelectItem>
              ) : (
                versions.map((v) => (
                  <SelectItem key={v.version} value={String(v.version)}>
                    {`v${String(v.version)}`}
                    {v.description ? ` — ${v.description}` : ""}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      </div>
    )
  }

  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (uiPending) return
        if (!open) setEnabled(true)
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
                "button:not([disabled]), input:not([disabled]), select:not([disabled])",
              ) as HTMLElement | null) ?? null
            first?.focus()
          })
        }}
      >
        <PageBlocker active={uiPending} />

        <SheetHeader>
          <SheetTitle>{t("schedules.newSchedule")}</SheetTitle>
          <SheetDescription>{t("schedules.recentSchedulesDescription")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto p-4 pt-0">
          {loading ? (
            <SheetSkeleton t={t} />
          ) : workflows.length === 0 ? (
            <div className="px-4 pb-4">
              <Alert className="rounded-md">
                <Info aria-hidden="true" />
                <AlertTitle>{t("common.workflowRequiredTitle")}</AlertTitle>
                <AlertDescription>{t("common.workflowRequiredDescription")}</AlertDescription>
              </Alert>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-3">
                <CollapsibleSectionCard
                  title={t("schedules.sections.basic")}
                  icon={<span className="text-muted-foreground">①</span>}
                  defaultOpen
                  bodyClassName="p-4"
                  toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
                >
                  <FieldGroup className="gap-4">
                    <Field className="gap-2">
                      <FieldLabel>{t("common.entities.workflow")}</FieldLabel>
                      <WorkflowCombobox
                        items={workflows.map((w) => ({ id: w.id, name: w.name }))}
                        value={workflowId}
                        onValueChange={setWorkflowId}
                        disabled={uiPending}
                        placeholder={t("jobs.selectWorkflow")}
                        searchPlaceholder={t("common.workflowCombobox.searchPlaceholder")}
                        emptyText={t("common.workflowCombobox.empty")}
                        className="w-full"
                      />
                    </Field>

                    <Field className="gap-2">
                      <FieldLabel htmlFor="schedule-new-name">
                        {t("workflows.name")} <span className="font-normal">({t("common.optional")})</span>
                      </FieldLabel>
                      <Input
                        id="schedule-new-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={uiPending}
                      />
                    </Field>
                  </FieldGroup>
                </CollapsibleSectionCard>

                <CollapsibleSectionCard
                  title={t("common.scheduleRule")}
                  icon={<span className="text-muted-foreground">②</span>}
                  defaultOpen
                  bodyClassName="p-4"
                  toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
                >
                  <FieldGroup className="gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field className="gap-2">
                        <FieldLabel htmlFor="schedule-new-kind">{t("schedules.kind")}</FieldLabel>
                        <Select value={kind} onValueChange={(v) => setKind(toScheduleKind(v))} disabled={uiPending}>
                          <SelectTrigger id="schedule-new-kind" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CRON">{t("schedules.kindCron")}</SelectItem>
                            <SelectItem value="INTERVAL">{t("schedules.kindInterval")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>

                      <Field className="gap-2">
                        <FieldLabel htmlFor="schedule-new-status">{t("common.status")}</FieldLabel>
                        <Select
                          value={enabled ? "ENABLED" : "DISABLED"}
                          onValueChange={(v) => setEnabled(v === "ENABLED")}
                          disabled={uiPending}
                        >
                          <SelectTrigger id="schedule-new-status" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ENABLED">{t("schedules.enableAction")}</SelectItem>
                            <SelectItem value="DISABLED">{t("schedules.disableAction")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>

                    {kind === "CRON" ? (
                      <div className="grid gap-4">
                        <Field className="gap-2">
                          <FieldLabel htmlFor="schedule-new-cron">{t("schedules.cron")}</FieldLabel>
                          <Input
                            id="schedule-new-cron"
                            value={cron}
                            onChange={(e) => setCron(e.target.value)}
                            disabled={uiPending}
                          />
                        </Field>
                        <Field className="gap-2">
                          <FieldLabel>{t("schedules.timezone")}</FieldLabel>
                          <TimezoneCombobox
                            value={timezone}
                            onValueChange={setTimezone}
                            disabled={uiPending}
                            placeholder={t("schedules.timezoneSelect")}
                            searchPlaceholder={t("common.timezoneCombobox.searchPlaceholder")}
                            emptyText={t("common.timezoneCombobox.empty")}
                            commonGroupLabel={t("common.timezoneCombobox.commonGroup")}
                            allGroupLabel={t("common.timezoneCombobox.allGroup")}
                            className="w-full"
                          />
                        </Field>
                      </div>
                    ) : (
                      <Field className="gap-2">
                        <FieldLabel htmlFor="schedule-new-intervalMs">{t("schedules.intervalMs")}</FieldLabel>
                        <Input
                          id="schedule-new-intervalMs"
                          type="number"
                          value={String(intervalMs)}
                          onChange={(e) => setIntervalMs(Number(e.target.value || 0))}
                          disabled={uiPending}
                        />
                      </Field>
                    )}
                  </FieldGroup>
                </CollapsibleSectionCard>

                <CollapsibleSectionCard
                  title={t("common.executionPolicies")}
                  icon={<span className="text-muted-foreground">③</span>}
                  bodyClassName="p-4"
                  toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
                >
                  <div className="grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <FieldLabelWithHelp
                          label={t("schedules.detail.misfirePolicy")}
                          tooltip={t(misfireHintKey)}
                          htmlFor="schedule-new-misfire-policy"
                        />
                        <Select
                          value={misfirePolicy}
                          onValueChange={(v) => setMisfirePolicy(v as "SKIP" | "FIRE_ONCE" | "CATCH_UP")}
                          disabled={uiPending}
                        >
                          <SelectTrigger id="schedule-new-misfire-policy" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="FIRE_ONCE">{t("schedules.policies.misfire.FIRE_ONCE")}</SelectItem>
                            <SelectItem value="SKIP">{t("schedules.policies.misfire.SKIP")}</SelectItem>
                            <SelectItem value="CATCH_UP">{t("schedules.policies.misfire.CATCH_UP")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid gap-2">
                        <FieldLabelWithHelp
                          label={t("schedules.detail.overlapPolicy")}
                          tooltip={t(overlapHintKey)}
                          htmlFor="schedule-new-overlap-policy"
                        />
                        <Select
                          value={overlapPolicy}
                          onValueChange={(v) => setOverlapPolicy(v as "SKIP" | "ALLOW")}
                          disabled={uiPending}
                        >
                          <SelectTrigger id="schedule-new-overlap-policy" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="SKIP">{t("schedules.policies.overlap.SKIP")}</SelectItem>
                            <SelectItem value="ALLOW">{t("schedules.policies.overlap.ALLOW")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {misfirePolicy === "CATCH_UP" ? (
                      <div className="grid gap-2">
                        <FieldLabelWithHelp
                          label={t("schedules.detail.catchUpLimit")}
                          tooltip={t("schedules.policies.catchUpLimitHint", { max: 100 })}
                          htmlFor="schedule-new-catch-up-limit"
                        />
                        <Input
                          id="schedule-new-catch-up-limit"
                          type="number"
                          min={1}
                          max={100}
                          value={String(catchUpLimit)}
                          onChange={(e) => {
                            const n = Number(e.target.value || 0)
                            setCatchUpLimit(Math.max(1, Math.min(100, Number.isFinite(n) ? Math.floor(n) : 1)))
                          }}
                          disabled={uiPending}
                        />
                      </div>
                    ) : null}

                    <PinnedWorkflowVersionControls />
                  </div>
                </CollapsibleSectionCard>

                <CollapsibleSectionCard
                  title={t("common.inputs")}
                  icon={<span className="text-muted-foreground">④</span>}
                  bodyClassName="p-4"
                  toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
                >
                  {showSelectWorkflowAlert ? (
                    <InfoAlert
                      titleKey="common.selectWorkflowForInputsTitle"
                      descriptionKey="common.selectWorkflowForInputsDescription"
                    />
                  ) : showInputsLoadingSkeleton ? (
                    <ScheduleInputsSkeleton />
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
                          title={issuesTitle}
                          issues={issuesToShow}
                          onIssueClick={(iss) => {
                            const ed = inputJsonEditorRef.current
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
                          editorRef={inputJsonEditorRef}
                          value={inputJsonRaw}
                          onChange={setInputJsonRaw}
                          height={200}
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

                      {/* URL files (schedule-level, system-managed) */}
                      {urlFilesEnabled ? (
                        <div className="grid gap-2">
                          <UrlFilesEditor
                            title={urlFilesUi.title}
                            required={inputSpec?.fileInputs?.urlFiles?.required === true}
                            hintText={urlFilesUi.description}
                            rightSlot={
                              typeof urlMaxItems === "number" ? (
                                <Badge variant="outline" className="text-[10px]">
                                  {t("jobs.limitCount", { count: urlLines.length, max: urlMaxItems })}
                                </Badge>
                              ) : null
                            }
                            value={urlList}
                            onChange={(raw) => onUrlListChange(raw)}
                            rows={3}
                            textareaClassName="font-mono text-xs max-h-40 overflow-y-auto resize-none"
                            placeholder={"https://example.com/data.csv\nhttps://example.com/image.png"}
                            disabled={uiPending}
                            headerClassName="flex items-center justify-between gap-2"
                            titleRowClassName="flex min-w-0 items-center gap-2"
                          />
                        </div>
                      ) : null}
                    </div>
                  )}
                </CollapsibleSectionCard>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t p-4">
          <Button size="sm" className="w-full" onClick={() => submit()} disabled={!canSubmit || uiPending}>
            {uiPending ? <Spinner className="size-6" /> : <Plus />}
            {t("common.createAction")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => props.onOpenChange(false)}
            disabled={uiPending}
          >
            <X />
            {t("common.cancelAction")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
