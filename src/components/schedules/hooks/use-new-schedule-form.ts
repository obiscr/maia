"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import type { ErrorObject } from "ajv"

import { toast } from "@/lib/client/toast"
import { ajvErrorsToApiIssues, compileAjvValidator } from "@/lib/client/jsonschema"
import { ApiError } from "@/lib/shared/http/api"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"
import {
  parseWorkflowInputSpec,
  workflowInputSpecParamsShape,
  type JsonSchema,
  type WorkflowInputSpec,
} from "@/lib/shared/maia/input-spec"
import { isRecord } from "@/lib/shared/lang/is-record"
import type { ApiIssue } from "@/lib/shared/http/types"
import { fetchWorkflowStepCount } from "@/lib/client/workflows"

type Workflow = { id: string; name: string; hasInputSpec?: boolean; stepCount?: number }

export function useNewScheduleForm(params: { t: (key: string, vars?: Record<string, any>) => string }) {
  const { t } = params
  const router = useRouter()

  const DEFAULT_CATCH_UP_LIMIT = 100

  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [workflowId, _setWorkflowId] = useState<string>("")
  const [name, setName] = useState<string>("")
  const [kind, setKind] = useState<"CRON" | "INTERVAL">("CRON")
  const [cron, setCron] = useState<string>("0 * * * *")
  const [timezone, setTimezone] = useState<string>("UTC")
  const [intervalMs, setIntervalMs] = useState<number>(60_000)
  const [misfirePolicy, setMisfirePolicy] = useState<"SKIP" | "FIRE_ONCE" | "CATCH_UP">("FIRE_ONCE")
  const [catchUpLimit, setCatchUpLimit] = useState<number>(DEFAULT_CATCH_UP_LIMIT)
  const [overlapPolicy, setOverlapPolicy] = useState<"SKIP" | "ALLOW">("SKIP")
  // Lock workflow version by number (server resolves -> internal ID).
  const [pinnedWorkflowVersionNumber, setPinnedWorkflowVersionNumber] = useState<number | null>(null)
  const [inputJsonRaw, _setInputJsonRaw] = useState<string>("{}")
  const [inputTouched, setInputTouched] = useState(false)
  const [urlList, setUrlList] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [inputSpec, setInputSpec] = useState<WorkflowInputSpec | null>(null)
  const [inputSpecForKey, setInputSpecForKey] = useState<string | null>(null)
  const [inputSpecErr, setInputSpecErr] = useState<string | null>(null)
  const [inputSpecLoading, setInputSpecLoading] = useState(false)
  const [workflowStepCount, setWorkflowStepCount] = useState<number | null>(null)
  const [workflowStepCountLoading, setWorkflowStepCountLoading] = useState(false)
  const didAutoPrefillWorkflowRef = useRef<string | null>(null)
  const lastUrlTruncateToastAtRef = useRef<number>(0)
  const [submitError, setSubmitError] = useState<{ code: string; issues?: ApiIssue[] } | null>(null)

  const selectedWorkflow = useMemo(() => workflows.find((w) => w.id === workflowId) ?? null, [workflows, workflowId])
  const workflowHasInputSpec = selectedWorkflow?.hasInputSpec === true

  const urlLines = useMemo(
    () =>
      urlList
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    [urlList],
  )
  const urlMaxItems = inputSpec?.filesInput?.urlFiles?.maxItems

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
  const hasValidInputSpec = !!inputSpec && !inputSpecLoading && !inputSpecErr

  const paramsSchema = useMemo(() => (inputSpec?.paramsSchema ?? null) as JsonSchema | null, [inputSpec])
  const schemaShape = useMemo(() => workflowInputSpecParamsShape(inputSpec), [inputSpec])
  const schemaProps = useMemo(() => schemaShape.properties, [schemaShape.properties])
  const schemaRequired = useMemo(() => schemaShape.required, [schemaShape.required])

  const ajvValidate = useMemo(() => {
    if (!hasValidInputSpec) return null
    return compileAjvValidator(inputSpec?.paramsSchema)
  }, [hasValidInputSpec, inputSpec?.paramsSchema])

  const ajvResult = useMemo(() => {
    if (!workflowHasInputSpec) return { ok: true as const, errors: [] as ErrorObject[] }
    if (!ajvValidate) return { ok: false as const, errors: [] as ErrorObject[] }
    if (!jsonState.ok) return { ok: false as const, errors: [] as ErrorObject[] }
    const parsed = jsonState.parsed
    if (!isRecord(parsed)) return { ok: false as const, errors: [] as ErrorObject[] }
    const ok = ajvValidate(parsed) as boolean
    return { ok: ok as boolean, errors: (ajvValidate.errors ?? []) as ErrorObject[] }
  }, [workflowHasInputSpec, ajvValidate, jsonState])

  const clientValidationIssues: ApiIssue[] = useMemo(() => {
    if (!workflowHasInputSpec) return []
    if (inputSpecLoading) return []
    if (!hasValidInputSpec) return [{ path: "/inputSpec", keyword: "invalid", message: t("jobs.toastSchemaInvalid") }]
    if (!jsonState.ok)
      return [{ path: "/inputJson", keyword: "json", message: inputJsonErr ?? t("errors.INVALID_JSON") }]
    const parsed = jsonState.parsed
    if (!isRecord(parsed)) {
      return [{ path: "/inputJson", keyword: "type", message: t("jobs.paramsMustBeObjectTitle") }]
    }
    if (!ajvResult.ok) {
      return ajvErrorsToApiIssues(ajvResult.errors)
    }
    return []
  }, [
    ajvResult.errors,
    ajvResult.ok,
    hasValidInputSpec,
    inputJsonErr,
    inputSpecLoading,
    jsonState,
    t,
    workflowHasInputSpec,
  ])

  const requiredOk = useMemo(() => {
    if (!workflowHasInputSpec) {
      const urlEnabled = inputSpec?.filesInput?.urlFiles?.enabled === true
      if (urlEnabled && inputSpec?.filesInput?.urlFiles?.required && urlLines.length === 0) return false
      return true
    }
    if (inputSpecLoading) return false
    if (!hasValidInputSpec) return false
    if (!jsonState.ok) return false
    const parsed = jsonState.parsed
    if (!isRecord(parsed)) return false

    const isFilled = (v: unknown) => {
      if (v == null) return false
      if (typeof v === "string") return v.trim().length > 0
      if (Array.isArray(v)) return v.length > 0
      return true
    }
    for (const k of schemaRequired) {
      if (!isFilled(parsed[k])) return false
    }

    // UI matches jobs: only enforce file constraints when urlFiles is explicitly enabled.
    const urlEnabled = inputSpec?.filesInput?.urlFiles?.enabled === true
    if (urlEnabled && inputSpec?.filesInput?.urlFiles?.required && urlLines.length === 0) return false
    return true
  }, [hasValidInputSpec, inputSpec, inputSpecLoading, jsonState, schemaRequired, urlLines.length, workflowHasInputSpec])

  const workflowHasSteps =
    typeof workflowStepCount === "number" && Number.isFinite(workflowStepCount) && workflowStepCount > 0
  const canSubmit =
    !!workflowId && !submitting && inputJsonOk && requiredOk && clientValidationIssues.length === 0 && workflowHasSteps

  function setInputJsonRaw(v: string) {
    setInputTouched(true)
    _setInputJsonRaw(v)
  }

  function buildTemplateFromSchema(schema: JsonSchema) {
    if (!schema || !isRecord(schema)) return {}
    if (schema.type !== "object") return {}
    if (!isRecord(schema.properties)) return {}
    const props = schema.properties
    const req = Array.isArray(schema.required) ? schema.required.filter((x): x is string => typeof x === "string") : []
    const out: Record<string, unknown> = {}
    for (const [k, def] of Object.entries(props)) {
      if (isRecord(def) && Object.prototype.hasOwnProperty.call(def, "default")) {
        out[k] = def.default
        continue
      }
      if (req.includes(k)) {
        const t = isRecord(def) ? def.type : undefined
        out[k] =
          t === "number" || t === "integer"
            ? 0
            : t === "boolean"
              ? false
              : t === "array"
                ? []
                : t === "object"
                  ? {}
                  : ""
      }
    }
    return out
  }

  async function refreshWorkflows() {
    setLoading(true)
    try {
      const j = await apiFetchJson<{ workflows: Workflow[] }>("/api/workflows", { cache: "no-store" })
      setWorkflows(j.workflows ?? [])
      _setWorkflowId((prev) => prev || j.workflows?.[0]?.id || "")
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.loadFailed" }))
    } finally {
      setLoading(false)
    }
  }

  function setWorkflowId(next: string) {
    const nextId = String(next ?? "")
    _setWorkflowId((prev) => {
      // UX: switching workflows should always reset pinned selection to avoid fetching/validating against a stale version number.
      if (prev !== nextId) {
        setPinnedWorkflowVersionNumber(null)
      }
      return nextId
    })
  }

  useEffect(() => {
    void refreshWorkflows()
  }, [])

  const desiredPinnedWorkflowVersion = useMemo(() => {
    if (typeof pinnedWorkflowVersionNumber !== "number" || !Number.isFinite(pinnedWorkflowVersionNumber)) return null
    return Math.floor(pinnedWorkflowVersionNumber)
  }, [pinnedWorkflowVersionNumber])

  // Determine whether the selected (possibly pinned) workflow has any steps.
  useEffect(() => {
    if (!workflowId) {
      setWorkflowStepCount(null)
      setWorkflowStepCountLoading(false)
      return
    }

    // Unpinned (Published: latest): use list stepCount (cheap, no extra fetch).
    if (desiredPinnedWorkflowVersion == null) {
      setWorkflowStepCount(
        typeof selectedWorkflow?.stepCount === "number" ? Math.max(0, selectedWorkflow.stepCount) : 0,
      )
      setWorkflowStepCountLoading(false)
      return
    }

    let cancelled = false
    setWorkflowStepCount(null)
    setWorkflowStepCountLoading(true)
    fetchWorkflowStepCount({ workflowId, pinnedWorkflowVersionNumber: desiredPinnedWorkflowVersion })
      .then((n) => {
        if (cancelled) return
        setWorkflowStepCount(Number.isFinite(n) ? Math.max(0, n) : 0)
      })
      .catch(() => {
        if (cancelled) return
        setWorkflowStepCount(null)
      })
      .finally(() => {
        if (cancelled) return
        setWorkflowStepCountLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [desiredPinnedWorkflowVersion, selectedWorkflow?.stepCount, workflowId])

  const autoPrefillKey = useMemo(() => {
    if (!workflowId) return ""
    return `${workflowId}:${desiredPinnedWorkflowVersion == null ? "LATEST" : `v${desiredPinnedWorkflowVersion}`}`
  }, [desiredPinnedWorkflowVersion, workflowId])

  // Reset state on workflow selection change.
  useEffect(() => {
    if (!workflowId) {
      setInputSpecLoading(false)
      setInputSpec(null)
      setInputSpecForKey(null)
      setInputSpecErr(null)
      didAutoPrefillWorkflowRef.current = null
      setInputTouched(false)
      _setInputJsonRaw("{}")
      setUrlList("")
      setSubmitError(null)
      return
    }

    // When switching workflows, reset pinned selection and inputs.
    setInputSpecLoading(false)
    setInputSpec(null)
    setInputSpecForKey(null)
    setInputSpecErr(null)
    didAutoPrefillWorkflowRef.current = null
    setInputTouched(false)
    _setInputJsonRaw("{}")
    setUrlList("")
    setSubmitError(null)
  }, [workflowId])

  // Fetch inputSpec for the selected workflow (and version when pinned).
  useEffect(() => {
    if (!workflowId) return
    let cancelled = false
    setInputSpecLoading(true)
    setInputSpec(null)
    setInputSpecForKey(null)
    setInputSpecErr(null)

    void (async () => {
      try {
        if (desiredPinnedWorkflowVersion != null) {
          const j = await apiFetchJson<{
            version?: { snapshot?: { inputSpec?: string | null } }
          }>(`/api/workflows/${encodeURIComponent(workflowId)}/versions/${desiredPinnedWorkflowVersion}`, {
            cache: "no-store",
          })
          if (cancelled) return
          const raw = typeof j?.version?.snapshot?.inputSpec === "string" ? j.version.snapshot.inputSpec : ""
          const parsed = parseWorkflowInputSpec(raw)
          if (parsed.error) {
            setInputSpec(null)
            setInputSpecForKey(null)
            setInputSpecErr(parsed.error)
          } else {
            setInputSpec(parsed.spec)
            setInputSpecForKey(autoPrefillKey)
            setInputSpecErr(null)
          }
          setInputSpecLoading(false)
          return
        }

        const j = await apiFetchJson<{ workflow?: { inputSpec?: string | null } }>(`/api/workflows/${workflowId}`, {
          cache: "no-store",
        })
        if (cancelled) return
        const raw = String(j?.workflow?.inputSpec ?? "").trim()
        const parsed = parseWorkflowInputSpec(raw)
        if (parsed.error) {
          setInputSpec(null)
          setInputSpecForKey(null)
          setInputSpecErr(parsed.error)
        } else {
          setInputSpec(parsed.spec)
          setInputSpecForKey(autoPrefillKey)
          setInputSpecErr(null)
        }
        setInputSpecLoading(false)
      } catch (e) {
        if (cancelled) return
        setInputSpec(null)
        setInputSpecForKey(null)
        // If user pinned a version but we couldn't fetch it, surface an error (otherwise we'd validate against the wrong schema).
        setInputSpecErr(desiredPinnedWorkflowVersion != null ? t("common.loadFailed") : null)
        setInputSpecLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [autoPrefillKey, desiredPinnedWorkflowVersion, t, workflowId])

  // Auto-prefill inputJson once per workflow, unless the user already typed.
  useEffect(() => {
    if (!workflowId) return
    if (inputTouched) return
    if (didAutoPrefillWorkflowRef.current === autoPrefillKey) return
    if (!inputSpec) return
    // Guard: never prefill using a spec fetched for a different workflow/version key.
    if (inputSpecForKey !== autoPrefillKey) return

    const ex0 = inputSpec.examples?.[0]
    // Prefer the first example's params (if present), otherwise fall back to schema-derived template.
    // Note: an empty example params {} is treated as an intentional template.
    const nextParams = ex0?.params ?? buildTemplateFromSchema(inputSpec.paramsSchema)
    _setInputJsonRaw(JSON.stringify(nextParams ?? {}, null, 2))
    if (ex0?.urlFiles?.length) {
      setUrlList(
        ex0.urlFiles
          .map((u) => String(u?.url ?? "").trim())
          .filter(Boolean)
          .join("\n"),
      )
    }
    didAutoPrefillWorkflowRef.current = autoPrefillKey
  }, [autoPrefillKey, workflowId, inputSpec, inputSpecForKey, inputTouched])

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

  async function createSchedule({ enabled }: { enabled: boolean }) {
    // Clear any prior server-side errors on a new attempt.
    setSubmitError(null)
    if (submitting) return { started: false as const }
    if (!workflowId) {
      toast.warning(t("jobs.selectWorkflow"))
      return { started: false as const }
    }
    if (!jsonState.ok) {
      toast.error(t("errors.INVALID_JSON"))
      return { started: false as const }
    }
    if (workflowHasInputSpec && !hasValidInputSpec) {
      toast.error(t("jobs.toastSchemaInvalid"))
      return { started: false as const }
    }
    if (workflowHasInputSpec && !requiredOk) {
      toast.warning(t("jobs.requiredFields"))
      return { started: false as const }
    }
    if (workflowHasInputSpec && clientValidationIssues.length) {
      const first = clientValidationIssues[0]
      const msg = first?.message ? String(first.message) : t("jobs.invalid")
      toast.error(t("jobs.toastValidationFailed", { message: msg }))
      return { started: false as const }
    }

    if (!canSubmit) return { started: false as const }
    setSubmitting(true)
    try {
      const parsed = jsonState.ok ? jsonState.parsed : null

      const shouldSendCatchUpLimit = misfirePolicy === "CATCH_UP"
      const pinnedVer =
        typeof pinnedWorkflowVersionNumber === "number" && Number.isFinite(pinnedWorkflowVersionNumber)
          ? Math.floor(pinnedWorkflowVersionNumber)
          : null

      const j = await apiFetchJson<{ schedule?: { id: string } }>("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId,
          name,
          kind,
          cron: kind === "CRON" ? cron : "",
          timezone,
          intervalMs: kind === "INTERVAL" ? intervalMs : undefined,
          enabled,
          misfirePolicy,
          overlapPolicy,
          ...(shouldSendCatchUpLimit ? { catchUpLimit } : {}),
          ...(pinnedVer != null ? { pinnedWorkflowVersionNumber: pinnedVer } : {}),
          inputJson: parsed,
          ...(urlLines.length ? { urlFiles: urlLines.map((u) => ({ url: u })) } : {}),
        }),
      })
      toast.success(t("schedules.createdToast"))
      const id = j?.schedule?.id
      if (id) router.push(`/schedules/${id}`)
      return { started: true as const }
    } catch (e) {
      const apiErr = e instanceof ApiError ? e : null
      if (apiErr?.issues?.length) {
        setSubmitError({ code: String(apiErr.code ?? "HTTP_ERROR"), issues: apiErr.issues })
      } else if (apiErr?.code) {
        setSubmitError({ code: String(apiErr.code ?? "HTTP_ERROR") })
      }
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
      setSubmitting(false)
      return { started: false as const }
    }
  }

  return {
    workflows,
    workflowId,
    setWorkflowId,
    workflowHasInputSpec,
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
    inputSpecForKey,
    inputSpecErr,
    inputSpecLoading,
    workflowStepCount,
    workflowStepCountLoading,
    hasValidInputSpec,
    schemaProps,
    schemaRequired,
    ajvResult,
    clientValidationIssues,
    submitError,
    loading,
    submitting,
    canSubmit,
    createSchedule,
  }
}
