"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Braces, Info, Save, X } from "lucide-react"
import type { ErrorObject } from "ajv"
import type { editor as MonacoEditor } from "monaco-editor"

import { useI18n } from "@/components/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PageBlocker } from "@/components/ui/page-blocker"
import { TimezoneCombobox } from "@/components/common/timezone-combobox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { scheduleJsonStatusUiSpec, type ScheduleJsonUiStatus } from "@/lib/shared/schedule-status"
import { ApiError, apiFetchJson } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"
import { tApiError, tError } from "@/lib/shared/i18n/error"
import { ajvErrorsToApiIssues, compileAjvValidator } from "@/lib/client/jsonschema"
import { FieldLabelWithHelp } from "@/components/common/field-label-with-help"
import { CollapsibleSectionCard } from "@/components/common/collapsible-section-card"
import { Badge } from "@/components/ui/badge"
import { isRecord } from "@/lib/shared/lang/is-record"
import {
  parseWorkflowInputSpec,
  workflowInputSpecParamsShape,
  type WorkflowInputSpec,
} from "@/lib/shared/maia/input-spec"
import { ScheduleInputsSkeleton, SheetSkeleton } from "./common-schedule-sheet-skeleton"
import type { ApiIssue } from "@/lib/shared/http/types"
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
import { fetchWorkflowInputSpecRaw } from "@/lib/client/workflows"
import { WorkflowVersionSelect } from "@/components/common/workflow-version-select"

function toScheduleKind(v: string): "CRON" | "INTERVAL" {
  return v === "INTERVAL" ? "INTERVAL" : "CRON"
}

export type EditScheduleModel = {
  id: string
  workflowId: string | null
  workflowName: string | null
  name: string | null
  enabled: boolean
  kind: "CRON" | "INTERVAL"
  cron: string | null
  timezone: string | null
  intervalMs: number | null
  misfirePolicy: "SKIP" | "FIRE_ONCE" | "CATCH_UP"
  catchUpLimit: number | null
  overlapPolicy: "SKIP" | "ALLOW"
  pinnedWorkflowVersionNumber: number | null
  inputJson: unknown
  urlFiles?: Array<{ id?: string; url: string; name?: string }> | null
}

export function EditScheduleSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  schedule: EditScheduleModel | null
  onSave: (scheduleId: string, patch: Partial<EditScheduleModel>) => Promise<void> | void
}) {
  const { t } = useI18n()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const inputJsonEditorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const s = props.schedule
  const workflowId = String(s?.workflowId ?? "").trim()

  const DEFAULT_CATCH_UP_LIMIT = 100

  const [pending, setPending] = useState(false)
  const uiPending = pending
  const loading = props.open && !s

  const [name, setName] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [kind, setKind] = useState<"CRON" | "INTERVAL">("CRON")
  const [cron, setCron] = useState("0 * * * *")
  const [timezone, setTimezone] = useState("UTC")
  const [intervalMs, setIntervalMs] = useState<number>(60_000)
  const [misfirePolicy, setMisfirePolicy] = useState<"SKIP" | "FIRE_ONCE" | "CATCH_UP">("FIRE_ONCE")
  const [catchUpLimit, setCatchUpLimit] = useState<number>(DEFAULT_CATCH_UP_LIMIT)
  const [overlapPolicy, setOverlapPolicy] = useState<"SKIP" | "ALLOW">("SKIP")
  const [pinnedWorkflowVersionNumber, setPinnedWorkflowVersionNumber] = useState<number | null>(null)
  const [inputJsonRaw, _setInputJsonRaw] = useState<string>("{}")
  const [inputTouched, setInputTouched] = useState(false)
  const [urlList, setUrlList] = useState<string>("")

  const misfireHintKeyByPolicy: Record<"SKIP" | "FIRE_ONCE" | "CATCH_UP", string> = {
    FIRE_ONCE: "schedules.policies.misfireHint.FIRE_ONCE",
    SKIP: "schedules.policies.misfireHint.SKIP",
    CATCH_UP: "schedules.policies.misfireHint.CATCH_UP",
  }

  const overlapHintKeyByPolicy: Record<"SKIP" | "ALLOW", string> = {
    SKIP: "schedules.policies.overlapHint.SKIP",
    ALLOW: "schedules.policies.overlapHint.ALLOW",
  }

  const misfireHintKey = misfireHintKeyByPolicy[misfirePolicy]
  const overlapHintKey = overlapHintKeyByPolicy[overlapPolicy]

  const urlLines = useMemo(
    () =>
      urlList
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    [urlList],
  )

  const [inputSpec, setInputSpec] = useState<WorkflowInputSpec | null>(null)
  const [inputSpecErr, setInputSpecErr] = useState<string | null>(null)
  const [inputSpecLoading, setInputSpecLoading] = useState(false)
  const lastUrlTruncateToastAtRef = useRef<number>(0)
  const urlMaxItems = inputSpec?.fileInputs?.urlFiles?.maxItems
  const [submitError, setSubmitError] = useState<{ code: string; issues?: ApiIssue[] } | null>(null)

  // Sync from schedule when opening/switching.
  useEffect(() => {
    if (!props.open || !s) return
    setName(s.name ?? "")
    setEnabled(Boolean(s.enabled))
    setKind(s.kind)
    setCron(String(s.cron ?? "0 * * * *"))
    setTimezone(String(s.timezone ?? "UTC"))
    setIntervalMs(typeof s.intervalMs === "number" ? s.intervalMs : 60_000)
    setMisfirePolicy(s.misfirePolicy ?? "FIRE_ONCE")
    setCatchUpLimit(typeof s.catchUpLimit === "number" ? s.catchUpLimit : DEFAULT_CATCH_UP_LIMIT)
    setOverlapPolicy(s.overlapPolicy ?? "SKIP")
    const pinned =
      typeof s.pinnedWorkflowVersionNumber === "number" && Number.isFinite(s.pinnedWorkflowVersionNumber)
        ? s.pinnedWorkflowVersionNumber
        : null
    setPinnedWorkflowVersionNumber(pinned)
    setInputTouched(false)
    setSubmitError(null)
    if (typeof s.inputJson === "string") setInputJsonRaw(s.inputJson.trim().length ? s.inputJson : "{}")
    else {
      try {
        setInputJsonRaw(JSON.stringify(s.inputJson ?? {}, null, 2))
      } catch {
        setInputJsonRaw("{}")
      }
    }
    const urls = Array.isArray(s.urlFiles) ? s.urlFiles.map((u) => String(u?.url ?? "").trim()).filter(Boolean) : []
    setUrlList(urls.join("\n"))
  }, [props.open, s?.id])

  // Fetch workflow inputSpec (for inputs UI + validation).
  useEffect(() => {
    if (!props.open || !workflowId) {
      setInputSpec(null)
      setInputSpecErr(null)
      setInputSpecLoading(false)
      return
    }
    let cancelled = false
    setInputSpec(null)
    setInputSpecErr(null)
    setInputSpecLoading(true)
    const desiredPinnedWorkflowVersion =
      typeof pinnedWorkflowVersionNumber === "number" && Number.isFinite(pinnedWorkflowVersionNumber)
        ? Math.floor(pinnedWorkflowVersionNumber)
        : null

    fetchWorkflowInputSpecRaw({ workflowId, pinnedWorkflowVersionNumber: desiredPinnedWorkflowVersion })
      .then((j) => {
        if (cancelled) return
        const parsed = parseWorkflowInputSpec(j)
        setInputSpec(parsed.error ? null : parsed.spec)
        setInputSpecErr(parsed.error ?? null)
        setInputSpecLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setInputSpec(null)
        setInputSpecErr(desiredPinnedWorkflowVersion != null ? t("common.loadFailed") : null)
        setInputSpecLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [pinnedWorkflowVersionNumber, props.open, t, workflowId])

  function onUrlListChange(raw: string) {
    const max = typeof urlMaxItems === "number" ? urlMaxItems : null
    if (!max) return setUrlList(raw)
    const lines = raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
    if (lines.length <= max) return setUrlList(raw)

    setUrlList(lines.slice(0, max).join("\n"))
    const now = Date.now()
    if (now - lastUrlTruncateToastAtRef.current > 800) {
      lastUrlTruncateToastAtRef.current = now
      toast.warning(t("jobs.toastUrlsTruncated", { max }))
    }
  }

  const jsonState = useMemo(() => {
    const raw = String(inputJsonRaw ?? "")
    try {
      const parsed: unknown = raw.trim() ? JSON.parse(raw) : {}
      return { ok: true as const, parsed }
    } catch (e) {
      return { ok: false as const, parsed: null as unknown, error: e }
    }
  }, [inputJsonRaw])

  const inputJsonOk = jsonState.ok
  const inputJsonErr = jsonState.ok
    ? null
    : jsonState.error instanceof Error
      ? jsonState.error.message
      : String(jsonState.error)

  function setInputJsonRaw(v: string) {
    setInputTouched(true)
    _setInputJsonRaw(v)
    // Clear any prior submit error once the user edits inputs.
    setSubmitError(null)
  }

  const hasValidInputSpec = !!inputSpec && !inputSpecLoading && !inputSpecErr

  const schemaShape = useMemo(() => workflowInputSpecParamsShape(inputSpec), [inputSpec])
  const schemaProps = useMemo(() => schemaShape.properties, [schemaShape.properties])
  const schemaRequired = useMemo(() => schemaShape.required, [schemaShape.required])

  const ajvValidate = useMemo(() => {
    if (!hasValidInputSpec) return null
    return compileAjvValidator(inputSpec?.paramsSchema)
  }, [hasValidInputSpec, inputSpec?.paramsSchema])

  const ajvResult = useMemo(() => {
    if (!inputSpec) return { ok: true as const, errors: [] as ErrorObject[] }
    if (!ajvValidate) return { ok: false as const, errors: [] as ErrorObject[] }
    if (!jsonState.ok) return { ok: false as const, errors: [] as ErrorObject[] }
    const parsed = jsonState.parsed
    if (!isRecord(parsed)) return { ok: false as const, errors: [] as ErrorObject[] }
    const ok = ajvValidate(parsed) as boolean
    return { ok: ok as boolean, errors: (ajvValidate.errors ?? []) as ErrorObject[] }
  }, [ajvValidate, inputSpec, jsonState])

  const clientValidationIssues: ApiIssue[] = useMemo(() => {
    // If there's no input spec for this workflow, nothing to validate here.
    if (!inputSpec) return []
    if (inputSpecLoading) return []
    if (!hasValidInputSpec) return [{ path: "/inputSpec", keyword: "invalid", message: t("jobs.toastSchemaInvalid") }]
    if (!jsonState.ok)
      return [{ path: "/inputJson", keyword: "json", message: inputJsonErr ?? t("errors.INVALID_JSON") }]
    const parsed = jsonState.parsed
    if (!isRecord(parsed)) return [{ path: "/inputJson", keyword: "type", message: t("jobs.paramsMustBeObjectTitle") }]
    if (!ajvResult.ok) return ajvErrorsToApiIssues(ajvResult.errors)
    return []
  }, [ajvResult.errors, ajvResult.ok, hasValidInputSpec, inputJsonErr, inputSpec, inputSpecLoading, jsonState, t])

  const requiredOk = useMemo(() => {
    const urlEnabled = inputSpec?.fileInputs?.urlFiles?.enabled === true
    if (urlEnabled && inputSpec?.fileInputs?.urlFiles?.required && urlLines.length === 0) return false
    return true
  }, [inputSpec, urlLines.length])

  const canSubmit = useMemo(() => {
    if (!s) return false
    if (inputSpecLoading) return false
    if (!inputJsonOk) return false
    if (!requiredOk) return false
    if (clientValidationIssues.length) return false
    if (kind === "CRON") return cron.trim().length > 0 && timezone.trim().length > 0
    return Number.isFinite(intervalMs) && intervalMs >= 1000
  }, [clientValidationIssues.length, cron, inputJsonOk, inputSpecLoading, intervalMs, kind, requiredOk, s, timezone])
  const inputJsonStatus: ScheduleJsonUiStatus = !inputJsonRaw.trim().length
    ? "NOT_CONFIGURED"
    : inputJsonOk
      ? "VALID"
      : "INVALID"
  const inputJsonUi = scheduleJsonStatusUiSpec(inputJsonStatus)
  const inputJsonStatusLabel =
    inputJsonStatus === "NOT_CONFIGURED"
      ? t("common.notConfigured")
      : inputJsonStatus === "VALID"
        ? t("workflows.inputSpec.validJson")
        : t("errors.INVALID_JSON")

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
    !!submitError || (workflowId && !!inputSpec && !inputSpecLoading && issuesToShow.length > 0) || inputTouched
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

  async function submit() {
    if (!s || uiPending || !canSubmit) return
    if (!inputJsonOk) return
    setSubmitError(null)
    if (inputSpec && clientValidationIssues.length) {
      const first = clientValidationIssues[0]
      const msg = first?.message ? String(first.message) : t("jobs.invalid")
      toast.error(t("jobs.toastValidationFailed", { message: msg }))
      return
    }
    setPending(true)
    try {
      const pinnedWorkflowVersionNumberToSend =
        typeof pinnedWorkflowVersionNumber === "number" && Number.isFinite(pinnedWorkflowVersionNumber)
          ? Math.floor(pinnedWorkflowVersionNumber)
          : null

      const patch: Partial<EditScheduleModel> = {
        name,
        enabled,
        kind,
        cron: kind === "CRON" ? cron : null,
        timezone: kind === "CRON" ? timezone : "UTC",
        intervalMs: kind === "INTERVAL" ? intervalMs : null,
        misfirePolicy,
        overlapPolicy,
        ...(misfirePolicy === "CATCH_UP" ? { catchUpLimit } : {}),
        pinnedWorkflowVersionNumber: pinnedWorkflowVersionNumberToSend,
        inputJson: jsonState.ok ? jsonState.parsed : {},
        urlFiles: urlLines.map((u) => ({ url: u })),
      }

      await props.onSave(s.id, patch)
      props.onOpenChange(false)
    } catch (e) {
      const apiErr = e instanceof ApiError ? e : null
      if (apiErr?.issues?.length) setSubmitError({ code: String(apiErr.code ?? "HTTP_ERROR"), issues: apiErr.issues })
      else if (apiErr?.code) setSubmitError({ code: String(apiErr.code ?? "HTTP_ERROR") })
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
    } finally {
      setPending(false)
    }
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
          <SheetTitle>{t("schedules.editScheduleAction")}</SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto p-4 pt-0">
          {loading ? (
            <SheetSkeleton t={t} />
          ) : !s ? (
            <div className="px-4 pb-4">
              <Alert className="rounded-md">
                <Info aria-hidden="true" />
                <AlertTitle>{t("common.loading")}</AlertTitle>
                <AlertDescription>{t("common.loading")}</AlertDescription>
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
                      <Select value={workflowId || "__none"} disabled>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={workflowId || "__none"}>{s.workflowName ?? "—"}</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field className="gap-2">
                      <WorkflowVersionSelect
                        t={t}
                        workflowId={workflowId}
                        value={pinnedWorkflowVersionNumber}
                        onChange={setPinnedWorkflowVersionNumber}
                        disabled={uiPending || !workflowId}
                        allowDraft={true}
                        labelTooltip={t("common.workflowVersion.scheduleAffectsFutureOnlyTooltip")}
                      />
                    </Field>

                    <Field className="gap-2">
                      <FieldLabel htmlFor="schedule-edit-name">
                        {t("workflows.name")} <span className="font-normal">({t("common.optional")})</span>
                      </FieldLabel>
                      <Input
                        id="schedule-edit-name"
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
                        <FieldLabel htmlFor="schedule-edit-kind">{t("schedules.kind")}</FieldLabel>
                        <Select value={kind} onValueChange={(v) => setKind(toScheduleKind(v))} disabled={uiPending}>
                          <SelectTrigger id="schedule-edit-kind" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CRON">{t("schedules.kindCron")}</SelectItem>
                            <SelectItem value="INTERVAL">{t("schedules.kindInterval")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>

                      <Field className="gap-2">
                        <FieldLabel htmlFor="schedule-edit-status">{t("common.status")}</FieldLabel>
                        <Select
                          value={enabled ? "ENABLED" : "DISABLED"}
                          onValueChange={(v) => setEnabled(v === "ENABLED")}
                          disabled={uiPending}
                        >
                          <SelectTrigger id="schedule-edit-status" className="w-full">
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
                          <FieldLabel htmlFor="schedule-edit-cron">{t("schedules.cron")}</FieldLabel>
                          <Input
                            id="schedule-edit-cron"
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
                        <FieldLabel htmlFor="schedule-edit-intervalMs">{t("schedules.intervalMs")}</FieldLabel>
                        <Input
                          id="schedule-edit-intervalMs"
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
                          htmlFor="schedule-edit-misfire-policy"
                        />
                        <Select
                          value={misfirePolicy}
                          onValueChange={(v) => setMisfirePolicy(v as "SKIP" | "FIRE_ONCE" | "CATCH_UP")}
                          disabled={uiPending}
                        >
                          <SelectTrigger id="schedule-edit-misfire-policy" className="w-full">
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
                          htmlFor="schedule-edit-overlap-policy"
                        />
                        <Select
                          value={overlapPolicy}
                          onValueChange={(v) => setOverlapPolicy(v as "SKIP" | "ALLOW")}
                          disabled={uiPending}
                        >
                          <SelectTrigger id="schedule-edit-overlap-policy" className="w-full">
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
                          htmlFor="schedule-edit-catch-up-limit"
                        />
                        <Input
                          id="schedule-edit-catch-up-limit"
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
          <Button size="sm" className="w-full" onClick={() => void submit()} disabled={!canSubmit || uiPending}>
            {uiPending ? <Spinner className="size-6" /> : <Save />}
            {t("common.saveAction")}
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
