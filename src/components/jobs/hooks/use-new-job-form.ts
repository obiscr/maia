"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import type { ErrorObject } from "ajv"

import { toast } from "@/lib/client/toast"
import { ajvErrorsToApiIssues, compileAjvValidator } from "@/lib/client/jsonschema"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"
import {
  extractJsonSchemaObjectShape,
  parseWorkflowInputSpec,
  workflowInputSpecParamsShape,
  type JsonSchema,
  type WorkflowInputSpec,
} from "@/lib/shared/maia/input-spec"
import { isRecord } from "@/lib/shared/lang/is-record"

type Workflow = { id: string; name: string; hasInputSpec?: boolean; stepCount?: number }

export function useNewJobForm(params: {
  t: (key: string, vars?: Record<string, any>) => string
  redirectTo?: "job" | "run"
}) {
  const { t, redirectTo } = params
  const router = useRouter()

  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [workflowId, setWorkflowIdRaw] = useState<string>("")
  const [inputJson, setInputJson] = useState<string>('{"url":"https://example.com"}')
  const [urlList, setUrlList] = useState<string>("")
  const [files, setFiles] = useState<File[]>([])
  const [pinnedWorkflowVersionNumber, setPinnedWorkflowVersionNumber] = useState<number | null>(null)
  const [inputTouched, setInputTouched] = useState(false)
  const [loading, setLoading] = useState(true)
  const [inputSpec, setInputSpec] = useState<WorkflowInputSpec | null>(null)
  const [inputSpecForWorkflowId, setInputSpecForWorkflowId] = useState<string | null>(null)
  const [inputSpecErr, setInputSpecErr] = useState<string | null>(null)
  const [inputSpecLoading, setInputSpecLoading] = useState(false)
  const [workflowStepCount, setWorkflowStepCount] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const didAutoPrefillWorkflowRef = useRef<string | null>(null)
  const lastUrlTruncateToastAtRef = useRef<number>(0)

  function setWorkflowId(nextWorkflowId: string) {
    // User-driven workflow selection: clear all inputs and any pinned version.
    didAutoPrefillWorkflowRef.current = null
    setInputTouched(false)
    setInputJson("{}")
    setUrlList("")
    setFiles([])
    setPinnedWorkflowVersionNumber(null)
    setWorkflowStepCount(null)
    setWorkflowIdRaw(nextWorkflowId)
  }

  const urlLines = useMemo(
    () =>
      urlList
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    [urlList],
  )

  const urlMaxItems = inputSpec?.filesInput?.urlFiles?.maxItems
  const uploadMaxItems = inputSpec?.filesInput?.uploadFiles?.maxItems

  const jsonState = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(inputJson || "{}")
      return { ok: true as const, parsed }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  }, [inputJson])

  const selectedWorkflow = useMemo(() => workflows.find((w) => w.id === workflowId) ?? null, [workflows, workflowId])
  const hasValidInputSpec = !!inputSpec && !inputSpecLoading && !inputSpecErr
  const hasMultipart = files.length > 0 || urlLines.length > 0
  const workflowHasInputSchema = selectedWorkflow?.hasInputSpec === true

  const schemaShape = useMemo(() => workflowInputSpecParamsShape(inputSpec), [inputSpec])
  const schemaProps = useMemo(() => schemaShape.properties, [schemaShape.properties])
  const schemaRequired = useMemo(() => schemaShape.required, [schemaShape.required])

  const ajvValidate = useMemo(() => {
    if (!hasValidInputSpec) return null
    return compileAjvValidator(inputSpec?.paramsSchema)
  }, [hasValidInputSpec, inputSpec?.paramsSchema])

  const ajvResult = useMemo(() => {
    if (!workflowHasInputSchema) return { ok: true as const, errors: [] as ErrorObject[] }
    if (!ajvValidate) return { ok: false as const, errors: [] as ErrorObject[] }
    if (!jsonState.ok) return { ok: false as const, errors: [] as ErrorObject[] }
    const parsed = jsonState.parsed
    if (!isRecord(parsed)) return { ok: false as const, errors: [] as ErrorObject[] }
    const ok = ajvValidate(parsed) as boolean
    return { ok: ok as boolean, errors: (ajvValidate.errors ?? []) as ErrorObject[] }
  }, [workflowHasInputSchema, ajvValidate, jsonState])

  const clientValidationIssues = useMemo(() => {
    // If this workflow has no input schema, we intentionally don't validate params here.
    if (!workflowHasInputSchema) return []

    // If workflow declares it has an input schema, but we can't load/compile it, show that clearly.
    if (inputSpecLoading) return []
    if (!hasValidInputSpec) return [{ path: "/inputSpec", keyword: "invalid", message: t("jobs.toastSchemaInvalid") }]

    // JSON syntax errors should be shown as a structured issue (consistent with schedules).
    if (!jsonState.ok) return [{ path: "/inputJson", keyword: "json", message: String(jsonState.error ?? "") }]

    // Params must be an object for AJV object-schema based workflows.
    if (!isRecord(jsonState.parsed)) {
      return [{ path: "/inputJson", keyword: "type", message: t("jobs.paramsMustBeObjectTitle") }]
    }

    // Schema validation (AJV).
    if (!ajvResult.ok) return ajvErrorsToApiIssues(ajvResult.errors)
    return []
  }, [ajvResult.errors, ajvResult.ok, hasValidInputSpec, inputSpecLoading, jsonState, t, workflowHasInputSchema])

  function buildTemplateFromSchema(schema: JsonSchema) {
    const shape = extractJsonSchemaObjectShape(schema)
    if (!shape.properties) return {}
    const props = shape.properties
    const req = shape.required
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
      setWorkflowIdRaw((prev) => prev || j.workflows?.[0]?.id || "")
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.loadFailed" }))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshWorkflows()
  }, [])

  useEffect(() => {
    if (!workflowId) {
      setInputSpec(null)
      setInputSpecForWorkflowId(null)
      setInputSpecErr(null)
      setInputSpecLoading(false)
      setWorkflowStepCount(null)
      return
    }

    let cancelled = false
    setInputSpecLoading(true)
    // Clear the previous workflow's spec immediately so we never validate/prefill using stale examples/schema.
    setInputSpec(null)
    setInputSpecForWorkflowId(null)
    setInputSpecErr(null)
    setWorkflowStepCount(null)

    const loadInputSpec = async () => {
      // If we are cloning from a run (pinned version known), load spec from that workflow version snapshot.
      if (typeof pinnedWorkflowVersionNumber === "number" && pinnedWorkflowVersionNumber > 0) {
        const j = await apiFetchJson<{
          version?: { snapshot?: { inputSpec?: string | null; steps?: Array<unknown> | null } | null }
        }>(`/api/workflows/${workflowId}/versions/${encodeURIComponent(String(pinnedWorkflowVersionNumber))}`, {
          cache: "no-store",
        })
        const raw = (j?.version?.snapshot?.inputSpec ?? null) as string | null
        const stepCount = Array.isArray(j?.version?.snapshot?.steps) ? (j?.version?.snapshot?.steps ?? []).length : 0
        const parsed = parseWorkflowInputSpec(raw)
        if (raw && !parsed.spec)
          return { spec: null as WorkflowInputSpec | null, err: parsed.error ?? "INVALID_INPUT_SPEC", stepCount }
        return { spec: parsed.spec, err: null as string | null, stepCount }
      }

      const j = await apiFetchJson<{ workflow?: { inputSpec?: string | null; steps?: Array<unknown> | null } }>(
        `/api/workflows/${workflowId}`,
        {
          cache: "no-store",
        },
      )
      const raw = String(j?.workflow?.inputSpec ?? "").trim()
      const stepCount = Array.isArray(j?.workflow?.steps)
        ? (j?.workflow?.steps ?? []).length
        : (selectedWorkflow?.stepCount ?? 0)
      const parsed = parseWorkflowInputSpec(raw)
      if (parsed.error) return { spec: null as WorkflowInputSpec | null, err: parsed.error, stepCount }
      return { spec: parsed.spec, err: null as string | null, stepCount }
    }

    void loadInputSpec()
      .then((r) => {
        if (cancelled) return
        setWorkflowStepCount(
          typeof r.stepCount === "number" && Number.isFinite(r.stepCount) ? Math.max(0, r.stepCount) : 0,
        )
        if (r.err) {
          setInputSpec(null)
          setInputSpecForWorkflowId(null)
          setInputSpecErr(r.err)
          return
        }
        setInputSpec(r.spec)
        setInputSpecForWorkflowId(workflowId)
        setInputSpecErr(null)
      })
      .catch(() => {
        if (cancelled) return
        setInputSpec(null)
        setInputSpecForWorkflowId(null)
        setInputSpecErr(null)
        setWorkflowStepCount(null)
      })
      .finally(() => {
        if (cancelled) return
        setInputSpecLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [workflowId, pinnedWorkflowVersionNumber, selectedWorkflow?.stepCount])

  // Prefill from querystring if present (create job "from run" flow).
  useEffect(() => {
    if (typeof window === "undefined") return
    const sp = new URLSearchParams(window.location.search)
    const qWorkflowId = sp.get("workflowId")
    const fromRunId = sp.get("fromRunId")
    if (qWorkflowId) setWorkflowId(qWorkflowId)

    // One-time params: remove from URL after consuming (keep other query params intact).
    // - `workflowId` preselects a workflow
    // - `fromRunId` triggers additional prefill fetch
    if (sp.has("workflowId") || sp.has("fromRunId")) {
      sp.delete("workflowId")
      sp.delete("fromRunId")
      const nextQs = sp.toString()
      const nextUrl = nextQs.length ? `${window.location.pathname}?${nextQs}` : window.location.pathname
      router.replace(nextUrl)
    }

    if (!fromRunId) return

    apiFetchJson<{
      run?: { workflowId?: string | null; initialInput?: string | null; workflowVersionNumber?: number | null }
    }>(`/api/runs/${fromRunId}`, {
      cache: "no-store",
    })
      .then((j) => {
        const r = j?.run
        if (!r) return
        if (r.workflowId) setWorkflowIdRaw(String(r.workflowId))
        if (
          typeof r.workflowVersionNumber === "number" &&
          Number.isInteger(r.workflowVersionNumber) &&
          r.workflowVersionNumber > 0
        ) {
          setPinnedWorkflowVersionNumber(r.workflowVersionNumber)
        }
        // We are applying an explicit prefill (from an existing run), so never auto-prefill examples for this workflow.
        if (r.workflowId) didAutoPrefillWorkflowRef.current = String(r.workflowId)

        try {
          const parsed: unknown = JSON.parse(r.initialInput || "{}")
          let normalized = parsed
          if (isRecord(parsed) && Array.isArray(parsed.files)) {
            const filesArr = parsed.files
            const urls = filesArr
              .filter((f) => isRecord(f) && f.source === "url" && typeof f.url === "string" && f.url.trim())
              .map((f) => String((f as Record<string, unknown>).url).trim())
            if (urls.length) setUrlList(urls.join("\n"))
            normalized = { ...parsed }
            delete (normalized as Record<string, unknown>).files
          }
          setInputJson(JSON.stringify(normalized ?? {}, null, 2))
        } catch {
          // ignore
        }
      })
      .catch(() => {})
  }, [t])

  // Auto-prefill initial params once per workflow.
  useEffect(() => {
    if (!workflowId) return
    if (inputTouched) return
    if (didAutoPrefillWorkflowRef.current === workflowId) return
    if (!inputSpec) return
    // Guard: never prefill using a spec fetched for a different workflow.
    if (inputSpecForWorkflowId !== workflowId) return
    const ex0 = inputSpec.examples?.[0]
    const nextParams = ex0?.params ?? buildTemplateFromSchema(inputSpec.paramsSchema)
    setInputJson(JSON.stringify(nextParams ?? {}, null, 2))
    if (ex0?.urlFiles?.length) {
      setUrlList(
        ex0.urlFiles
          .map((u) => String(u?.url ?? "").trim())
          .filter(Boolean)
          .join("\n"),
      )
    }
    didAutoPrefillWorkflowRef.current = workflowId
  }, [workflowId, inputSpec, inputSpecForWorkflowId, inputTouched, schemaProps])

  const requiredOk = useMemo(() => {
    if (!workflowHasInputSchema) return true
    if (schemaRequired.length === 0) return true
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

    // Match the UI: file inputs are only active when explicitly enabled.
    const urlEnabled = inputSpec?.filesInput?.urlFiles?.enabled === true
    const uploadEnabled = inputSpec?.filesInput?.uploadFiles?.enabled === true
    if (urlEnabled && inputSpec?.filesInput?.urlFiles?.required && urlLines.length === 0) return false
    if (uploadEnabled && inputSpec?.filesInput?.uploadFiles?.required && files.length === 0) return false

    return true
  }, [
    workflowHasInputSchema,
    schemaRequired.length,
    inputSpecLoading,
    hasValidInputSpec,
    jsonState,
    schemaRequired,
    inputSpec,
    urlLines.length,
    files.length,
  ])

  const workflowHasSteps =
    typeof workflowStepCount === "number" && Number.isFinite(workflowStepCount) && workflowStepCount > 0
  const canSubmit = !!workflowId && !submitting && requiredOk && workflowHasSteps

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

  function onPickFiles(picked: File[]) {
    if (!picked.length) return
    const max = typeof uploadMaxItems === "number" ? uploadMaxItems : null
    if (!max) {
      setFiles((prev) => [...prev, ...picked])
      return
    }
    setFiles((prev) => {
      const remain = Math.max(0, max - prev.length)
      const accepted = picked.slice(0, remain)
      const ignored = picked.length - accepted.length
      if (ignored > 0)
        toast.warning(t("jobs.toastUploadsIgnored", { max, ignored }), {
          id: "jobs.uploads-ignored",
        })
      if (accepted.length === 0)
        toast.info(t("jobs.toastUploadsMaxReached", { max }), {
          id: "jobs.uploads-max-reached",
        })
      return [...prev, ...accepted]
    })
  }

  async function createJob({ start }: { start: boolean }): Promise<{ started: boolean; jobId?: string }> {
    if (submitting) return { started: true }
    if (!workflowId) {
      toast.warning(t("jobs.selectWorkflow"))
      return { started: false }
    }
    if (workflowStepCount === 0) {
      toast.warning(t("common.workflowNoStepsTitle"))
      return { started: false }
    }
    if (!jsonState.ok) {
      toast.error(jsonState.error)
      return { started: false }
    }

    if (workflowHasInputSchema && !hasValidInputSpec) {
      toast.error(t("jobs.toastSchemaInvalid"))
      return { started: false }
    }
    if (workflowHasInputSchema && !requiredOk) {
      toast.warning(t("jobs.requiredFields"))
      return { started: false }
    }
    if (workflowHasInputSchema && !ajvResult.ok) {
      const first = clientValidationIssues[0]
      const msg = first?.message ? String(first.message) : t("jobs.invalid")
      toast.error(t("jobs.toastValidationFailed", { message: msg }))
      return { started: false }
    }

    setSubmitting(true)
    try {
      const j = hasMultipart
        ? await (async () => {
            const fd = new FormData()
            fd.append("workflowId", workflowId)
            fd.append("initialInput", JSON.stringify(jsonState.parsed ?? {}))
            if (typeof pinnedWorkflowVersionNumber === "number" && pinnedWorkflowVersionNumber > 0) {
              fd.append("pinnedWorkflowVersionNumber", String(pinnedWorkflowVersionNumber))
            }
            fd.append("start", start ? "true" : "false")
            if (urlLines.length) fd.append("urlFiles", JSON.stringify(urlLines.map((u) => ({ url: u }))))
            for (const f of files) fd.append("files", f)
            return await apiFetchJson<{ job?: { id?: string } }>("/api/jobs", { method: "POST", body: fd })
          })()
        : await apiFetchJson<{ job?: { id?: string } }>("/api/jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workflowId,
              inputJson: jsonState.parsed,
              pinnedWorkflowVersionNumber:
                typeof pinnedWorkflowVersionNumber === "number" && pinnedWorkflowVersionNumber > 0
                  ? pinnedWorkflowVersionNumber
                  : undefined,
              start,
            }),
          })
      toast.success(start ? t("common.jobEnqueuedToast") : t("jobs.createdToast"))
      const id = j?.job?.id
      if (id) {
        if (redirectTo === "run") router.push(`/jobs/${id}?redirect=run`)
        else router.push(`/jobs/${id}`)
      }
      return { started: true, jobId: id }
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "jobs.startFailedTitle" }))
      setSubmitting(false)
      return { started: false }
    }
  }

  return {
    workflows,
    workflowId,
    setWorkflowId,
    pinnedWorkflowVersionNumber,
    setPinnedWorkflowVersionNumber,
    workflowStepCount,
    inputJson,
    setInputJson: (v: string) => {
      setInputTouched(true)
      setInputJson(v)
    },
    urlList,
    onUrlListChange,
    urlLines,
    urlMaxItems,
    uploadMaxItems,
    files,
    setFiles,
    onPickFiles,
    inputTouched,
    setInputTouched,
    jsonState,
    loading,
    inputSpec,
    inputSpecForWorkflowId,
    inputSpecErr,
    inputSpecLoading,
    hasValidInputSpec,
    workflowHasInputSchema,
    schemaProps,
    schemaRequired,
    requiredOk,
    ajvResult,
    clientValidationIssues,
    submitting,
    canSubmit,
    createJob,
    refreshWorkflows,
  }
}
