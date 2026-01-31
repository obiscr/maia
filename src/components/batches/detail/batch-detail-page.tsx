"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import type { ErrorObject } from "ajv"
import type { editor as MonacoEditor } from "monaco-editor"

import { useI18n } from "@/components/i18n-provider"
import { ErrorAlert } from "@/components/common/error-alert"
import { LoadingState } from "@/components/common/loading-state"
import { StandardListPage } from "@/components/common/standard-list-page"
import { CommonListItemSkeleton } from "@/components/common/common-list-item-skeleton"
import { JobsCommonListItem, type JobsListItemModel } from "@/components/jobs/list/jobs-common-list-item"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { TextareaWithChrome } from "@/components/common/textarea-with-chrome"
import { InfoAlert } from "@/components/common/info-alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ApiError, apiFetchJson } from "@/lib/shared/http/api"
import { calcDurationMs, formatDurationMs } from "@/lib/shared/format/time"
import { toCanonicalJobStatus } from "@/lib/shared/job-status"
import { toast } from "@/lib/client/toast"
import { tApiError, tError } from "@/lib/shared/i18n/error"
import { useStableListRows } from "@/hooks/use-stable-list-rows"
import { clampInt } from "@/hooks/list-page-utils"
import { useListQuery } from "@/hooks/list-query/use-list-query"
import { useListQueryState } from "@/hooks/list-query/use-list-query-state"
import { useTopicStream } from "@/hooks/use-topic-stream"
import { makeStreamTopic } from "@/lib/shared/realtime/topics"
import { monotonicMerge, parseIsoMs } from "@/lib/shared/realtime/monotonic"
import { useJobsListFilters } from "@/components/jobs/hooks/use-jobs-list-filters"
import { StandardPageHeader } from "@/components/common/standard-page-header"
import { DetailPageLayout } from "@/components/common/detail-page-layout"
import { PageLoadError } from "@/components/common/page-load-error"
import { isRecord } from "@/lib/shared/lang/is-record"
import { FieldLabelWithHelp } from "@/components/common/field-label-with-help"
import { HeaderSubbar } from "@/components/common/header-subbar"
import { CopyableIdBadge } from "@/components/common/copyable-id-badge"
import { SectionCard, SectionCardBody, SectionCardHeader } from "@/components/common/section-card"
import { TwoLineMiniCard } from "@/components/common/two-line-mini-card"
import { batchStatusUiSpec, toCanonicalBatchStatus } from "@/lib/shared/batch-status"
import { batchControlAvailability } from "@/lib/shared/batch-control"
import { cn } from "@/lib/utils"
import {
  Ban,
  Braces,
  Calendar,
  CheckCircle2,
  Clock,
  Clock3,
  ExternalLink,
  Layers,
  PauseCircle,
  Play,
  Save,
  WorkflowIcon,
  XCircle,
} from "lucide-react"
import Link from "next/link"
import { Separator } from "@/components/ui/separator"
import {
  extractJsonSchemaObjectShape,
  parseWorkflowInputSpec,
  workflowInputSpecHasParams,
  type WorkflowInputSpec,
} from "@/lib/shared/maia/input-spec"
import { workflowFileInputUi } from "@/lib/shared/maia/file-inputs-ui"
import type { ApiIssue } from "@/lib/shared/http/types"
import { ApiIssuesAlert } from "@/components/common/api-issues-alert"
import { JsonMonacoEditor } from "@/components/common/json-monaco-editor"
import { RichTextI18n } from "@/components/common/rich-text-i18n"
import { ajvErrorsToApiIssues, compileAjvValidator } from "@/lib/client/jsonschema"
import { UrlFilesEditor } from "@/components/common/url-files-editor"
import { Badge } from "@/components/ui/badge"
import { FanoutSectionInlineSkeleton } from "@/components/batches/detail/batch-detail-skeletons"
import { Spinner } from "@/components/ui/spinner"
import {
  focusJsonParseErrorInMonacoEditor,
  focusJsonPointerInMonacoEditor,
  normalizeJsonPointer,
} from "@/lib/client/json-pointer"
import { isPlainObject } from "@/lib/shared/lang/is-plain-object"

type JobStatusKey = "QUEUED" | "PAUSED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED"
type JobsByStatus = Record<JobStatusKey, number>

type BatchDetail = {
  id: string
  publicId: string
  publicNumber: number
  name: string | null
  status: string
  workflowId: string | null
  workflow: { id: string; publicId: string; publicNumber: number; name: string } | null
  pinnedWorkflowVersion: { version: number; createdAt: string; description: string | null } | null
  concurrencyLimit: number | null
  rampUpSeconds: number | null
  autoMaxConcurrency: number | null
  failFast: boolean
  maxFailures: number | null
  sourceJson: string
  urlFiles?: Array<{ id: string; url: string; name: string }>
  fanoutSeedJson?: string | null
  jobsTotal: number
  jobsByStatus: JobsByStatus
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

type JobsListDtoItem = {
  id: string
  workflowName: string | null
  status: string
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  runId: string | null
  attemptCount: number
  maxAttempts: number
}

function coerceJobsByStatus(x: unknown): JobsByStatus | null {
  if (!isRecord(x)) return null
  const base: JobsByStatus = {
    QUEUED: 0,
    PAUSED: 0,
    RUNNING: 0,
    SUCCEEDED: 0,
    FAILED: 0,
    CANCELED: 0,
  }
  for (const k of Object.keys(base) as JobStatusKey[]) {
    const v = x[k]
    base[k] = typeof v === "number" && Number.isFinite(v) ? v : 0
  }
  return base
}

export default function BatchDetailPage() {
  const { t, locale } = useI18n()
  const params = useParams<{ batchId: string }>()
  const batchId = String(params?.batchId ?? "")
  const queryClient = useQueryClient()

  const [batch, setBatch] = React.useState<BatchDetail | null>(null)
  const [err, setErr] = React.useState<unknown>(null)
  const [loading, setLoading] = React.useState(true) // initial-only
  const [refreshing, setRefreshing] = React.useState(false)

  const searchInputRef = React.useRef<HTMLInputElement | null>(null)
  const BATCH_JOBS_PAGE_SIZE = 50

  type JobsState = {
    qDraft: string
    q: string
    exactStatus: string
    sort: "CREATED_DESC" | "CREATED_ASC"
    pageIndex: number
  }

  const {
    state: jobsState,
    setState: setJobsState,
    didInit: jobsDidInit,
  } = useListQueryState<JobsState>({
    basePath: batchId ? `/batches/${batchId}` : "/batches",
    defaults: {
      qDraft: "",
      q: "",
      exactStatus: "ANY",
      sort: "CREATED_DESC",
      pageIndex: 0,
    },
    codec: {
      parse: (qp) => {
        const patch: Partial<JobsState> = {}
        const q = qp.get("q")
        if (typeof q === "string" && q.trim()) {
          patch.qDraft = q
          patch.q = q
        }
        const status = qp.get("status")
        if (typeof status === "string" && status.trim()) patch.exactStatus = status
        const sortRaw = qp.get("sort")
        if (sortRaw === "CREATED_ASC" || sortRaw === "CREATED_DESC") patch.sort = sortRaw

        const pageRaw = qp.get("page")
        const initialPage = pageRaw ? Number(pageRaw) : 1
        patch.pageIndex = Math.max(0, clampInt(initialPage, 1, 10_000) - 1)
        return patch
      },
      serialize: (s, qp) => {
        const q = s.q.trim()
        if (q) qp.set("q", q)
        else qp.delete("q")
        if (s.exactStatus !== "ANY") qp.set("status", s.exactStatus)
        else qp.delete("status")
        if (s.sort !== "CREATED_DESC") qp.set("sort", s.sort)
        else qp.delete("sort")
        if (s.pageIndex > 0) qp.set("page", String(s.pageIndex + 1))
        else qp.delete("page")
        return qp
      },
    },
    resetPageIndexDeps: [(s) => s.q, (s) => s.exactStatus, (s) => s.sort],
    onResetPageIndex: () => setJobsState((prev) => ({ ...prev, pageIndex: 0 })),
    urlMode: { strategy: "replaceState", kind: "replace" },
  })

  React.useEffect(() => {
    if (!jobsDidInit) return
    const tmr = window.setTimeout(() => {
      setJobsState((prev) => (prev.q === prev.qDraft ? prev : { ...prev, q: prev.qDraft }))
    }, 250)
    return () => window.clearTimeout(tmr)
  }, [jobsDidInit, jobsState.qDraft, setJobsState])

  const [seedJsonText, setSeedJsonText] = React.useState<string>("{}")
  const [seedTouched, setSeedTouched] = React.useState(false)
  const seedJsonEditorRef = React.useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const [fanoutSubmitError, setFanoutSubmitError] = React.useState<{ code: string; issues?: ApiIssue[] } | null>(null)
  const [fanoutStartNow, setFanoutStartNow] = React.useState(true)
  const [fanoutSubmitting, setFanoutSubmitting] = React.useState(false)
  const [fanoutShardCount, setFanoutShardCount] = React.useState(1)
  const [fanoutShardIndex, setFanoutShardIndex] = React.useState(0)
  const [fanoutUrlList, setFanoutUrlList] = React.useState<string>("")
  const lastUrlTruncateToastAtRef = React.useRef<number>(0)
  const didAutoPrefillWorkflowRef = React.useRef<string | null>(null)

  const locked = !!batch && ((typeof batch.jobsTotal === "number" && batch.jobsTotal > 0) || !!batch.startedAt)

  // Batch settings (editable only before fanout).
  type WorkflowVersionRow = { id: string; version: number; description: string | null }
  const [versions, setVersions] = React.useState<WorkflowVersionRow[]>([])
  const [versionsLoading, setVersionsLoading] = React.useState(false)
  const [pinnedMode, setPinnedMode] = React.useState<"LATEST" | "PINNED">("LATEST")
  const [pinnedWorkflowVersionNumber, setPinnedWorkflowVersionNumber] = React.useState<number | null>(null)
  const [concurrencyLimitDraft, setConcurrencyLimitDraft] = React.useState<number | null>(null)
  const [rampUpSecondsDraft, setRampUpSecondsDraft] = React.useState<number | null>(null)
  const [autoMaxConcurrencyDraft, setAutoMaxConcurrencyDraft] = React.useState<number | null>(null)
  const [failFastDraft, setFailFastDraft] = React.useState(false)
  const [maxFailuresDraft, setMaxFailuresDraft] = React.useState<number | null>(null)
  const [sourceJsonDraft, setSourceJsonDraft] = React.useState<string>("{}")
  const [settingsTouched, setSettingsTouched] = React.useState(false)

  const [inputSpec, setInputSpec] = React.useState<WorkflowInputSpec | null>(null)
  const [inputSpecForWorkflowId, setInputSpecForWorkflowId] = React.useState<string | null>(null)
  const [inputSpecErr, setInputSpecErr] = React.useState<string | null>(null)
  const [inputSpecLoading, setInputSpecLoading] = React.useState(false)

  const paramsEditorEnabled = React.useMemo(() => {
    if (!batch?.workflowId) return false
    return workflowInputSpecHasParams(inputSpec)
  }, [batch?.workflowId, inputSpec])

  const urlFilesEnabled = inputSpec?.filesInput?.urlFiles?.enabled === true
  const urlMaxItems = inputSpec?.filesInput?.urlFiles?.maxItems
  const urlFilesUi = React.useMemo(() => workflowFileInputUi(inputSpec, "urlFiles", t("jobs.urlFiles")), [inputSpec, t])

  const seedJsonState = React.useMemo(() => {
    const raw = String(seedJsonText ?? "")
    try {
      const parsed: unknown = raw.trim() ? JSON.parse(raw) : {}
      return { ok: true as const, parsed }
    } catch (e) {
      return { ok: false as const, parsed: null as unknown, error: e }
    }
  }, [seedJsonText])

  const seedJsonErr = seedJsonState.ok
    ? null
    : seedJsonState.error instanceof Error
      ? seedJsonState.error.message
      : String(seedJsonState.error)

  function expandSeedToItemsClient(seed: unknown): { kind: "array" | "items"; items: unknown[] } {
    if (Array.isArray(seed)) return { kind: "array", items: seed }
    if (isPlainObject(seed)) {
      const items = seed.items
      if (Array.isArray(items)) return { kind: "items", items }
    }
    return { kind: "array", items: [seed] }
  }

  function buildTemplateFromSchema(schema: Record<string, unknown> | null | undefined) {
    const shape = extractJsonSchemaObjectShape(schema)
    if (!shape.properties) return {}
    const props = shape.properties
    const req = shape.required
    const out: Record<string, unknown> = {}
    for (const [k, def] of Object.entries(props)) {
      if (isRecord(def) && Object.prototype.hasOwnProperty.call(def, "default")) {
        out[k] = (def as Record<string, unknown>).default
        continue
      }
      if (req.includes(k)) {
        const t = isRecord(def) ? (def as Record<string, unknown>).type : undefined
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

  function buildSeedJsonFromExampleOrSchema(spec: WorkflowInputSpec) {
    const examples = Array.isArray(spec.examples) ? spec.examples : []
    const exampleItems = examples
      .map((ex) => {
        const p = isRecord(ex) ? (ex as Record<string, unknown>).params : null
        return isRecord(p) ? p : null
      })
      .filter((x): x is Record<string, unknown> => x != null)

    const items = exampleItems.length ? exampleItems : [buildTemplateFromSchema(spec.paramsSchema)]

    // Batch fanout supports: a single object, an array, or { items: [...] }.
    // We prefill with the { items: [ ... ] } shape to make "fan-out list" explicit.
    return { items: items.map((it) => it ?? {}) }
  }

  // If this batch has already fanned out, show the persisted fanout seed exactly.
  React.useEffect(() => {
    const wfId = batch?.workflowId ? String(batch.workflowId) : ""
    if (!wfId) return
    if (!locked) return
    if (seedTouched) return
    const stored = String(batch?.fanoutSeedJson ?? "").trim()
    if (!stored) return
    try {
      const parsed = JSON.parse(stored) as unknown
      setSeedJsonText(JSON.stringify(parsed ?? {}, null, 2))
    } catch {
      // If somehow invalid JSON was stored, fall back to raw text.
      setSeedJsonText(stored)
    }
    didAutoPrefillWorkflowRef.current = wfId
  }, [batch?.fanoutSeedJson, batch?.workflowId, locked, seedTouched])

  // Auto-prefill seed JSON once per workflow (same behavior as /jobs), unless the user already typed.
  React.useEffect(() => {
    const wfId = batch?.workflowId ? String(batch.workflowId) : ""
    if (!wfId) return
    if (!paramsEditorEnabled) return
    if (!inputSpec) return
    // Guard: never prefill using a spec fetched for a different workflow.
    if (inputSpecForWorkflowId !== wfId) return
    if (seedTouched) return
    if (didAutoPrefillWorkflowRef.current === wfId) return
    if (String(batch?.fanoutSeedJson ?? "").trim()) return

    // Don't overwrite if user already has non-trivial content.
    const raw = String(seedJsonText ?? "").trim()
    const isDefaultEmpty = raw === "" || raw === "{}" || raw === "null"
    if (!isDefaultEmpty) return

    const seed = buildSeedJsonFromExampleOrSchema(inputSpec)
    setSeedJsonText(JSON.stringify(seed, null, 2))
    didAutoPrefillWorkflowRef.current = wfId
  }, [batch?.workflowId, inputSpec, inputSpecForWorkflowId, paramsEditorEnabled, seedJsonText, seedTouched])

  function itemPointerPrefix(kind: "array" | "items", index: number) {
    if (kind === "items") return `/items/${index}`
    return `/${index}`
  }

  const ajvValidate = React.useMemo(() => {
    if (!inputSpec) return null
    return compileAjvValidator(inputSpec.paramsSchema)
  }, [inputSpec])

  const fanoutClientValidationIssues: ApiIssue[] = React.useMemo(() => {
    // Match schedules/jobs UX: if params editor isn't enabled, treat params as empty and skip params validation.
    if (!paramsEditorEnabled) return []
    // If there's no inputSpec for this workflow, we can't validate required fields; still reserve `files`.
    if (!seedJsonState.ok) return [{ path: "/", keyword: "json", message: seedJsonErr ?? "Invalid JSON" }]

    const { kind, items } = expandSeedToItemsClient(seedJsonState.parsed)
    const issues: ApiIssue[] = []

    // Reserved `files` field (system-managed) should never be provided in seed.
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (isRecord(it) && Object.prototype.hasOwnProperty.call(it, "files")) {
        issues.push({
          path: `${itemPointerPrefix(kind, i)}/files`,
          keyword: "reserved",
          message: "Reserved field (system-managed).",
          params: { field: "files", index: i },
        })
      }
    }

    if (!inputSpec) return issues
    if (inputSpecLoading) return []
    if (!ajvValidate || inputSpecErr)
      return [{ path: "/inputSpec", keyword: "invalid", message: t("jobs.toastSchemaInvalid") }]

    // When workflow has inputSpec, each fanout item must be an object and must satisfy paramsSchema.
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const base = itemPointerPrefix(kind, i)
      if (!isRecord(it)) {
        issues.push({
          path: base,
          keyword: "type",
          message: "fanout items must be objects when workflow has inputSpec",
          params: { index: i },
        })
        continue
      }
      const ok = ajvValidate(it) as boolean
      if (!ok) {
        const errs = (ajvValidate.errors ?? []) as ErrorObject[]
        const iss = ajvErrorsToApiIssues(errs).map((x) => ({
          ...x,
          path: `${base}${x.path === "/" ? "" : x.path}`,
        }))
        issues.push(...iss)
      }
    }

    return issues
  }, [ajvValidate, inputSpec, inputSpecErr, inputSpecLoading, paramsEditorEnabled, seedJsonErr, seedJsonState, t])

  const fanoutIssuesToShow = fanoutSubmitError?.issues?.length ? fanoutSubmitError.issues : fanoutClientValidationIssues
  const showFanoutIssues = paramsEditorEnabled && (!!fanoutSubmitError || seedTouched) && fanoutIssuesToShow.length > 0
  const fanoutIssuesTitle = tError({
    t,
    code: fanoutSubmitError?.code ?? "INVALID_INITIAL_INPUT",
    fallbackKey: "errors.INVALID_INITIAL_INPUT",
  })

  const canFormatSeed = seedJsonState.ok && !!String(seedJsonText ?? "").trim().length
  function formatSeedJson() {
    const raw = String(seedJsonText ?? "").trim()
    if (!raw.length) return
    try {
      const parsed = JSON.parse(raw)
      const formatted = JSON.stringify(parsed, null, 2)
      if (formatted === raw) return

      const ed = seedJsonEditorRef.current
      const focused = !!ed && typeof ed.hasTextFocus === "function" ? ed.hasTextFocus() : false
      const selection = focused && ed ? ed.getSelection() : null
      const scrollTop = focused && ed ? ed.getScrollTop() : null

      setSeedTouched(true)
      setFanoutSubmitError(null)
      setSeedJsonText(formatted)
      if (focused) {
        requestAnimationFrame(() => {
          const ed2 = seedJsonEditorRef.current
          if (!ed2) return
          if (scrollTop != null) ed2.setScrollTop(scrollTop)
          if (selection) ed2.setSelection(selection)
        })
      }
    } catch {
      // If JSON is invalid, keep current content unchanged.
    }
  }

  React.useEffect(() => {
    if (!batch || settingsTouched) return
    const ver = batch.pinnedWorkflowVersion?.version
    setPinnedMode(typeof ver === "number" && Number.isFinite(ver) ? "PINNED" : "LATEST")
    setPinnedWorkflowVersionNumber(typeof ver === "number" && Number.isFinite(ver) ? ver : null)
    setConcurrencyLimitDraft(typeof batch.concurrencyLimit === "number" ? batch.concurrencyLimit : null)
    setRampUpSecondsDraft(typeof batch.rampUpSeconds === "number" ? batch.rampUpSeconds : null)
    setAutoMaxConcurrencyDraft(typeof batch.autoMaxConcurrency === "number" ? batch.autoMaxConcurrency : null)
    setFailFastDraft(Boolean(batch.failFast))
    setMaxFailuresDraft(typeof batch.maxFailures === "number" ? batch.maxFailures : null)

    // Provenance/sourceJson (best-effort pretty print)
    try {
      const parsed = JSON.parse(String(batch.sourceJson ?? "{}"))
      setSourceJsonDraft(JSON.stringify(parsed ?? {}, null, 2))
    } catch {
      setSourceJsonDraft(String(batch.sourceJson ?? "{}"))
    }
  }, [batch, settingsTouched])

  // Fetch workflow inputSpec (for urlFiles constraints + UI guidance).
  React.useEffect(() => {
    const wfId = batch?.workflowId
    if (!wfId) {
      setInputSpec(null)
      setInputSpecForWorkflowId(null)
      setInputSpecErr(null)
      setInputSpecLoading(false)
      return
    }
    let cancelled = false
    setInputSpec(null)
    setInputSpecForWorkflowId(null)
    setInputSpecErr(null)
    setInputSpecLoading(true)
    apiFetchJson<{ workflow?: { inputSpec?: string | null } }>(`/api/workflows/${wfId}`, { cache: "no-store" })
      .then((j) => {
        if (cancelled) return
        const raw = String(j?.workflow?.inputSpec ?? "").trim()
        const parsed = parseWorkflowInputSpec(raw)
        setInputSpec(parsed.error ? null : parsed.spec)
        setInputSpecForWorkflowId(parsed.error ? null : String(wfId))
        setInputSpecErr(parsed.error ?? null)
      })
      .catch(() => {
        if (cancelled) return
        setInputSpec(null)
        setInputSpecForWorkflowId(null)
        setInputSpecErr(null)
      })
      .finally(() => {
        if (cancelled) return
        setInputSpecLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [batch?.workflowId])

  React.useEffect(() => {
    if (!batch) return
    const urls = Array.isArray(batch.urlFiles)
      ? batch.urlFiles.map((u) => String(u?.url ?? "").trim()).filter(Boolean)
      : []
    setFanoutUrlList(urls.join("\n"))
  }, [batch?.id])

  React.useEffect(() => {
    const wfId = batch?.workflowId
    if (!wfId) {
      setVersions([])
      return
    }
    let cancelled = false
    setVersionsLoading(true)
    apiFetchJson<{ versions?: WorkflowVersionRow[] }>(`/api/workflows/${wfId}/versions?pageSize=50&sort=CREATED_DESC`, {
      cache: "no-store",
    })
      .then((j) => {
        if (cancelled) return
        setVersions(Array.isArray(j?.versions) ? (j.versions as WorkflowVersionRow[]) : [])
      })
      .catch(() => {
        if (cancelled) return
        setVersions([])
      })
      .finally(() => {
        if (cancelled) return
        setVersionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [batch?.workflowId])

  const latestVersion = React.useMemo(() => {
    const vs = versions
      .map((v) => (typeof v.version === "number" ? v.version : null))
      .filter((x): x is number => x != null)
    return vs.length ? Math.max(...vs) : null
  }, [versions])

  const versionSelectValue = React.useMemo(() => {
    return typeof pinnedWorkflowVersionNumber === "number" ? String(pinnedWorkflowVersionNumber) : ""
  }, [pinnedWorkflowVersionNumber])

  async function saveSettings() {
    if (!batchId) return
    const pinned =
      pinnedMode === "PINNED" &&
      typeof pinnedWorkflowVersionNumber === "number" &&
      Number.isFinite(pinnedWorkflowVersionNumber)
        ? Math.floor(pinnedWorkflowVersionNumber)
        : null
    try {
      let sourceParsed: unknown = {}
      try {
        sourceParsed = sourceJsonDraft.trim() ? JSON.parse(sourceJsonDraft) : {}
      } catch {
        toast.error(t("errors.INVALID_JSON"))
        return
      }
      const patchBody: Record<string, unknown> = {
        sourceJson: sourceParsed,
        concurrencyLimit: concurrencyLimitDraft,
        rampUpSeconds: rampUpSecondsDraft,
        autoMaxConcurrency: autoMaxConcurrencyDraft,
      }
      // Locked-after-fanout fields must be omitted entirely, otherwise the API returns 409 (BATCH_LOCKED).
      if (!locked) {
        patchBody.pinnedWorkflowVersionNumber = pinnedMode === "PINNED" ? pinned : null
        patchBody.failFast = Boolean(failFastDraft)
        patchBody.maxFailures = maxFailuresDraft
      }

      await apiFetchJson(`/api/batches/${batchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      })
      toast.success(t("batches.updatedToast"))
      setSettingsTouched(false)
      void refreshBatch({ background: true })
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.updateFailed" }))
    }
  }

  async function pauseBatch() {
    if (!batchId) return
    try {
      await apiFetchJson(`/api/batches/${batchId}/pause`, { method: "POST" })
      toast.success(t("batches.pausedToast"))
      void refreshBatch({ background: true })
      void refreshJobs()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
    }
  }

  async function resumeBatch() {
    if (!batchId) return
    try {
      await apiFetchJson(`/api/batches/${batchId}/resume`, { method: "POST" })
      toast.success(t("batches.resumedToast"))
      void refreshBatch({ background: true })
      void refreshJobs()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
    }
  }

  async function cancelBatch() {
    if (!batchId) return
    try {
      await apiFetchJson(`/api/batches/${batchId}/cancel`, { method: "POST" })
      toast.success(t("batches.canceledToast"))
      void refreshBatch({ background: true })
      void refreshJobs()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
    }
  }

  const refreshBatch = React.useCallback(
    async (opts?: { background?: boolean }) => {
      const background = opts?.background === true
      if (!background) setLoading(true)
      else setRefreshing(true)
      try {
        const j = await apiFetchJson<{ batch?: BatchDetail }>(`/api/batches/${batchId}`, { cache: "no-store" })
        setBatch(j.batch ?? null)
        setErr(null)
      } catch (e) {
        setErr(e)
      } finally {
        if (!background) setLoading(false)
        setRefreshing(false)
      }
    },
    [batchId],
  )

  React.useEffect(() => {
    void refreshBatch()
  }, [refreshBatch])

  const jobsQueryKey = React.useMemo(
    () =>
      [
        "batchJobs",
        {
          batchId,
          q: jobsState.q.trim(),
          exactStatus: jobsState.exactStatus,
          sort: jobsState.sort,
          pageIndex: jobsState.pageIndex,
          pageSize: BATCH_JOBS_PAGE_SIZE,
        },
      ] as const,
    [BATCH_JOBS_PAGE_SIZE, batchId, jobsState.exactStatus, jobsState.pageIndex, jobsState.q, jobsState.sort],
  )

  const jobsQuery = useListQuery<{ jobs: JobsListDtoItem[]; total: number }>({
    queryKey: jobsQueryKey,
    enabled: !!batchId,
    queryFn: async ({ signal }) => {
      const qs = new URLSearchParams()
      qs.set("batchId", batchId)
      qs.set("page", String(jobsState.pageIndex + 1))
      qs.set("pageSize", String(BATCH_JOBS_PAGE_SIZE))
      qs.set("sort", jobsState.sort)
      const q = jobsState.q.trim()
      if (q) qs.set("q", q)
      if (jobsState.exactStatus !== "ANY") qs.set("status", jobsState.exactStatus)
      return await apiFetchJson(`/api/jobs?${qs.toString()}`, { cache: "no-store", signal })
    },
  })

  const jobsDto = Array.isArray(jobsQuery.data?.jobs) ? (jobsQuery.data?.jobs as JobsListDtoItem[]) : []
  const jobsTotal = Number(jobsQuery.data?.total) || 0
  const jobs = React.useMemo<JobsListItemModel[]>(
    () =>
      jobsDto.map((it) => ({
        id: it.id,
        title: it.workflowName ?? "—",
        status: it.status,
        queuedAt: it.queuedAt,
        startedAt: it.startedAt,
        finishedAt: it.finishedAt,
        runId: it.runId,
        attemptCount: it.attemptCount,
        maxAttempts: it.maxAttempts,
      })),
    [jobsDto],
  )

  const jobsHasData = !!jobsQuery.data
  const jobsLoading = jobsQuery.isLoading && !jobsHasData
  const jobsRefreshing = jobsQuery.isFetching && jobsHasData
  const jobsErr = (jobsQuery.error ?? null) as unknown

  const totalPages = React.useMemo(
    () => Math.max(1, Math.ceil(jobsTotal / BATCH_JOBS_PAGE_SIZE)),
    [BATCH_JOBS_PAGE_SIZE, jobsTotal],
  )
  const safePageIndex = React.useMemo(
    () => Math.min(jobsState.pageIndex, totalPages - 1),
    [jobsState.pageIndex, totalPages],
  )
  React.useEffect(() => {
    if (!jobsDidInit) return
    if (jobsState.pageIndex !== safePageIndex) setJobsState((prev) => ({ ...prev, pageIndex: safePageIndex }))
  }, [jobsDidInit, jobsState.pageIndex, safePageIndex, setJobsState])

  const refreshJobs = React.useCallback(async () => {
    await jobsQuery.refetch()
  }, [jobsQuery])

  const search = jobsState.qDraft
  const setSearch = React.useCallback(
    (next: string) => setJobsState((prev) => ({ ...prev, qDraft: next })),
    [setJobsState],
  )
  const exactStatus = jobsState.exactStatus
  const setExactStatus = React.useCallback(
    (next: string) => setJobsState((prev) => ({ ...prev, exactStatus: next })),
    [setJobsState],
  )
  const sort = jobsState.sort
  const setSort = React.useCallback(
    (next: "CREATED_DESC" | "CREATED_ASC") => setJobsState((prev) => ({ ...prev, sort: next })),
    [setJobsState],
  )
  const setPageIndex = React.useCallback(
    (next: number) => setJobsState((prev) => ({ ...prev, pageIndex: next })),
    [setJobsState],
  )

  // Realtime: subscribe to batch topic and refresh/update incrementally on events.
  const refreshTmrRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    return () => {
      if (refreshTmrRef.current) window.clearTimeout(refreshTmrRef.current)
    }
  }, [])
  useTopicStream({
    topic: batchId ? makeStreamTopic("batch", batchId) : null,
    enabled: !!batchId,
    onMessage: (msg) => {
      if (!msg?.type) return
      if (msg.type === "batch_state" && msg.topic) {
        const d = msg.data
        if (isRecord(d)) {
          setBatch((prev) => {
            if (!prev) return prev
            const patch: Partial<BatchDetail> & Record<string, unknown> = {}
            if (typeof d.status === "string") patch.status = d.status
            if (typeof d.startedAt === "string" || d.startedAt == null) patch.startedAt = d.startedAt as string | null
            if (typeof d.finishedAt === "string" || d.finishedAt == null)
              patch.finishedAt = d.finishedAt as string | null
            if (typeof d.jobsTotal === "number") patch.jobsTotal = d.jobsTotal
            const jobsByStatus = coerceJobsByStatus(d.jobsByStatus)
            if (jobsByStatus) patch.jobsByStatus = jobsByStatus

            return monotonicMerge(prev, patch, {
              getVersion: (x) => (isRecord(x) ? parseIsoMs(x.finishedAt ?? x.startedAt ?? null) : parseIsoMs(null)),
              getStatus: (x) => (isRecord(x) ? String(x.status ?? "").toUpperCase() : ""),
              terminalStatuses: ["SUCCEEDED", "FAILED", "CANCELED"],
            })
          })
        }
        return
      }

      if (msg.type === "job_state") {
        const d = msg.data
        const jobId = isRecord(d) ? String(d.jobId ?? "") : ""
        if (jobId) {
          // Patch the current list page cache (best-effort) so status updates feel instant.
          queryClient.setQueryData(jobsQueryKey, (old: unknown) => {
            if (!isRecord(old)) return old
            const oldJobs = Array.isArray(old.jobs) ? (old.jobs as unknown[]) : null
            if (!oldJobs) return old
            const nextJobs = oldJobs.map((it) => {
              if (!isRecord(it)) return it
              if (String(it.id ?? "") !== jobId) return it
              if (!isRecord(d)) return it
              const patch: Partial<JobsListDtoItem> & Record<string, unknown> = {}
              if (typeof d.status === "string") patch.status = d.status
              if (typeof d.queuedAt === "string") patch.queuedAt = d.queuedAt
              if (typeof d.startedAt === "string") patch.startedAt = d.startedAt
              if (typeof d.finishedAt === "string") patch.finishedAt = d.finishedAt
              if (typeof d.runId === "string") patch.runId = d.runId
              if (typeof d.attemptCount === "number") patch.attemptCount = d.attemptCount
              if (typeof d.maxAttempts === "number") patch.maxAttempts = d.maxAttempts

              return monotonicMerge(it, patch, {
                getVersion: (x) =>
                  isRecord(x) ? parseIsoMs(x.finishedAt ?? x.startedAt ?? x.queuedAt ?? null) : parseIsoMs(null),
                getStatus: (x) => (isRecord(x) ? String(x.status ?? "").toUpperCase() : ""),
                terminalStatuses: ["SUCCEEDED", "FAILED", "CANCELED"],
              })
            })
            return { ...old, jobs: nextJobs }
          })
        }
        // Debounced: refresh batch summary (jobsByStatus) and the current jobs page.
        if (refreshTmrRef.current) window.clearTimeout(refreshTmrRef.current)
        refreshTmrRef.current = window.setTimeout(() => {
          void refreshBatch({ background: true })
          void refreshJobs()
        }, 250)
      }
    },
  })

  // NOTE (Scheme A): do NOT prefill seed from provenance/sourceJson.
  // - Seed JSON is the execution input for fan-out.
  // - sourceJson is provenance/audit metadata and must not affect execution inputs implicitly.

  const skeletonCount = Math.min(BATCH_JOBS_PAGE_SIZE, 10)
  const { listItems } = useStableListRows({ rows: jobs, loading: jobsLoading, skeletonCount })

  function statusLabel(status: string) {
    const s = toCanonicalJobStatus(status)
    if (s === "SUCCEEDED") return t("common.statusValues.succeeded")
    if (s === "FAILED") return t("common.statusValues.failed")
    if (s === "RUNNING") return t("common.statusValues.running")
    if (s === "PAUSED") return t("common.statusValues.paused")
    if (s === "QUEUED") return t("common.statusValues.queued")
    if (s === "CANCELED") return t("common.statusValues.canceled")
    return s || "—"
  }

  function batchStatusLabel(status: string) {
    const s = toCanonicalBatchStatus(status)
    if (s === "SUCCEEDED") return t("common.statusValues.succeeded")
    if (s === "FAILED") return t("common.statusValues.failed")
    if (s === "RUNNING") return t("common.statusValues.running")
    if (s === "PAUSED") return t("common.statusValues.paused")
    if (s === "CREATED") return t("batches.statusCreated")
    if (s === "CANCELED") return t("common.statusValues.canceled")
    return s || "—"
  }

  const exactStatusOptions = React.useMemo(() => {
    const known = ["QUEUED", "PAUSED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]
    return ["ANY", ...known]
  }, [])

  const { filtersActive, clearFilters, renderFilters } = useJobsListFilters({
    t,
    search,
    setSearch,
    exactStatus,
    setExactStatus,
    exactStatusOptions,
    sort,
    setSort,
    setPageIndex,
    searchInputRef,
    statusLabel,
  })

  async function submitFanout() {
    if (fanoutSubmitting) return
    if (locked) return
    setSeedTouched(true)
    setFanoutSubmitError(null)
    if (fanoutClientValidationIssues.length > 0) {
      requestAnimationFrame(() => {
        const ed = seedJsonEditorRef.current
        const node = ed && typeof ed.getDomNode === "function" ? ed.getDomNode() : null
        node?.scrollIntoView({ behavior: "smooth", block: "center" })
        ed?.focus()
      })
      return
    }
    const parsed: unknown = paramsEditorEnabled ? (seedJsonState.ok ? seedJsonState.parsed : null) : {}
    if (paramsEditorEnabled && !seedJsonState.ok) return

    setFanoutSubmitting(true)
    try {
      const urlLines = fanoutUrlList
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
      const max = typeof urlMaxItems === "number" ? urlMaxItems : null
      const urlToSend = max ? urlLines.slice(0, max) : urlLines
      if (max && urlLines.length > max) {
        const now = Date.now()
        if (now - lastUrlTruncateToastAtRef.current > 800) {
          lastUrlTruncateToastAtRef.current = now
          toast.warning(t("jobs.toastUrlsTruncated", { max }))
        }
      }

      const j = await apiFetchJson<{ operationId: string; expanded: number; truncated: boolean; created?: number }>(
        `/api/batches/${batchId}/fanout`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            seedJson: parsed,
            start: fanoutStartNow,
            shardCount: fanoutShardCount,
            shardIndex: fanoutShardIndex,
            ...(urlFilesEnabled && urlToSend.length ? { urlFiles: urlToSend.map((u) => ({ url: u })) } : {}),
          }),
        },
      )
      // Layer2: fanout is async (202). Poll operation for final counts (best-effort).
      const opId = String(j?.operationId ?? "")
      if (!opId) {
        toast.success(t("batches.fanoutEnqueueAction"))
        return
      }

      toast.success(t("batches.fanoutEnqueueAction"))

      const startedAt = Date.now()
      const timeoutMs = 45_000
      const pollEveryMs = 750
      while (Date.now() - startedAt < timeoutMs) {
        await new Promise((r) => setTimeout(r, pollEveryMs))
        const op = await apiFetchJson<{
          operation: {
            status: string
            result: { status: number; body: unknown } | null
          }
        }>(`/api/operations/${encodeURIComponent(opId)}`, { cache: "no-store" })
        const st = String(op?.operation?.status ?? "")
        if (st === "SUCCEEDED") {
          const body = op?.operation?.result?.body ?? null
          const created =
            isRecord(body) && typeof body.created === "number" && Number.isFinite(body.created) ? body.created : 0
          const truncated = isRecord(body) ? Boolean(body.truncated) : false
          if (truncated) toast.warning(t("batches.fanoutTruncatedToast", { count: created }))
          else toast.success(t("batches.fanoutCreatedToast", { count: created }))
          return
        }
        if (st === "FAILED") {
          toast.error(tApiError({ t, err: op?.operation?.result?.body ?? null, fallbackKey: "common.error" }))
          return
        }
      }
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.issues) && e.issues.length > 0) {
        setFanoutSubmitError({ code: e.code, issues: e.issues })
        requestAnimationFrame(() => {
          const ed = seedJsonEditorRef.current
          const node = ed && typeof ed.getDomNode === "function" ? ed.getDomNode() : null
          node?.scrollIntoView({ behavior: "smooth", block: "center" })
          ed?.focus()
        })
        return
      }
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
    } finally {
      setFanoutSubmitting(false)
    }
  }

  const durationMs = calcDurationMs(batch?.startedAt, batch?.finishedAt)

  const canonBatchStatus = toCanonicalBatchStatus(String(batch?.status ?? ""))
  const ctl = batchControlAvailability({
    canonicalStatus: canonBatchStatus,
    statusCounts: {
      queued: Number(batch?.jobsByStatus?.QUEUED ?? 0) || 0,
      paused: Number(batch?.jobsByStatus?.PAUSED ?? 0) || 0,
      running: Number(batch?.jobsByStatus?.RUNNING ?? 0) || 0,
    },
  })
  const canPause = ctl.canPause
  const canResume = ctl.canResume
  const canCancel = ctl.canCancel
  const batchStatusUi = batchStatusUiSpec(canonBatchStatus)
  const BatchStatusIcon = batchStatusUi.Icon
  const batchStatusText = batch ? batchStatusLabel(String(batch.status ?? "")) : t("common.notFound")

  const pinnedSummary = React.useMemo(() => {
    const mode = pinnedMode
    const latest = latestVersion != null ? `v${String(latestVersion)}` : "—"
    if (mode !== "PINNED") return `${t("batches.pinnedModeLatest")} ${latest !== "—" ? `(${latest})` : ""}`.trim()
    const v = typeof pinnedWorkflowVersionNumber === "number" ? `v${String(pinnedWorkflowVersionNumber)}` : "—"
    return v
  }, [latestVersion, pinnedMode, pinnedWorkflowVersionNumber, t])

  const concurrencySummary = React.useMemo(() => {
    if (typeof concurrencyLimitDraft === "number" && Number.isFinite(concurrencyLimitDraft))
      return String(concurrencyLimitDraft)
    const ramp =
      typeof rampUpSecondsDraft === "number" && Number.isFinite(rampUpSecondsDraft)
        ? Math.max(1, Math.floor(rampUpSecondsDraft))
        : null
    const auto =
      typeof autoMaxConcurrencyDraft === "number" && Number.isFinite(autoMaxConcurrencyDraft)
        ? Math.max(1, Math.floor(autoMaxConcurrencyDraft))
        : null
    if (ramp != null && auto != null) return `1→${auto} / ${ramp}s`
    return "—"
  }, [autoMaxConcurrencyDraft, concurrencyLimitDraft, rampUpSecondsDraft])

  const failPolicySummary = React.useMemo(() => {
    const ff = Boolean(failFastDraft)
    if (ff) return t("batches.failurePolicyModeFailFast")
    const mf =
      typeof maxFailuresDraft === "number" && Number.isFinite(maxFailuresDraft)
        ? Math.max(1, Math.floor(maxFailuresDraft))
        : null
    if (mf != null) return `${t("batches.failurePolicyModeMaxFailures")}: ${mf}`
    return "—"
  }, [failFastDraft, maxFailuresDraft, t])

  const urlCountSummary = React.useMemo(() => {
    const lines = fanoutUrlList
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
    return String(lines.length)
  }, [fanoutUrlList])

  const fanoutUrlLines = React.useMemo(
    () =>
      fanoutUrlList
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    [fanoutUrlList],
  )

  const sourceConfiguredSummary = React.useMemo(() => {
    const raw = String(sourceJsonDraft ?? "").trim()
    if (!raw || raw === "{}") return t("common.notConfigured")
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return t("common.notConfigured")
      const keys = Object.keys(parsed as Record<string, unknown>)
      return keys.length ? t("common.saved") : t("common.notConfigured")
    } catch {
      return t("errors.INVALID_JSON")
    }
  }, [sourceJsonDraft, t])

  const headerProps = {
    title: (
      <div className="flex min-w-0 items-center gap-2">
        {batch ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center",
              batchStatusUi.varsClassName,
              batchStatusUi.textClassName,
            )}
            aria-label={batchStatusText}
            title={batchStatusText}
          >
            {BatchStatusIcon ? (
              <BatchStatusIcon
                aria-hidden="true"
                className={cn("size-5", batchStatusUi.iconClassName, batchStatusUi.textClassName)}
              />
            ) : null}
          </span>
        ) : null}
        <div className="min-w-0">
          <div className="truncate">{batch?.name ? String(batch.name) : t("nav.batches")}</div>
        </div>
      </div>
    ),
    description: loading ? (
      <span className="text-muted-foreground">{t("common.loading")}</span>
    ) : batch ? null : (
      <span className="text-muted-foreground">{t("common.notFound")}</span>
    ),
    right: (
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void pauseBatch()}
          disabled={!batch || loading || !canPause}
        >
          <PauseCircle className="size-4" aria-hidden="true" />
          {t("batches.controlPauseAction")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void resumeBatch()}
          disabled={!batch || loading || !canResume}
        >
          <Play className="size-4" aria-hidden="true" />
          {t("batches.controlResumeAction")}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => void cancelBatch()}
          disabled={!batch || loading || !canCancel}
        >
          <Ban className="size-4" aria-hidden="true" />
          {t("batches.controlCancelAction")}
        </Button>
      </div>
    ),
    bottom: (
      <HeaderSubbar hideAt="lg" className="flex-row items-center justify-between">
        <HeaderSubbar.Left>
          <div className="flex flex-wrap items-center gap-3">
            <CopyableIdBadge id={batchId} label={t("common.entities.batch")} Icon={Layers} />
            {batch?.workflowId ? (
              <div className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                <Link href={`/workflows/${batch.workflowId}`}>{String(batch?.workflow?.name ?? batch.workflowId)}</Link>
              </div>
            ) : null}
          </div>
        </HeaderSubbar.Left>
        {refreshing ? (
          <HeaderSubbar.Right>
            <div className="text-xs text-muted-foreground">{t("common.loading")}</div>
          </HeaderSubbar.Right>
        ) : null}
      </HeaderSubbar>
    ),
  } satisfies React.ComponentProps<typeof StandardPageHeader>

  // Main resource load failure: render a page-level error state (no top alert).
  if (err && !batch && !loading) {
    return (
      <PageLoadError error={err} onRetry={() => void refreshBatch()} backHref="/batches" backLabelKey="nav.batches" />
    )
  }

  // Initial-only skeleton (align with runs/jobs/schedules detail pages).
  if (loading && !batch && !err) {
    return <LoadingState textKey="common.loading" spinner placement="top" minHeightClassName="min-h-[40vh]" />
  }

  return (
    <DetailPageLayout header={<StandardPageHeader {...headerProps} />}>
      {/* Summary */}
      <SectionCard className="flex-none text-card-foreground">
        <SectionCardHeader>
          <div className="text-sm font-medium">{t("common.summary")}</div>
        </SectionCardHeader>
        <SectionCardBody className="p-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <TwoLineMiniCard
              title={t("batches.jobsTotal")}
              titleRight={<Layers className="size-4" aria-hidden="true" />}
              value={typeof batch?.jobsTotal === "number" ? String(batch.jobsTotal) : "—"}
              valueClassName="font-mono text-sm"
            />
            <TwoLineMiniCard
              title={t("common.statusValues.queued")}
              titleRight={<Clock className="size-4" aria-hidden="true" />}
              value={String(batch?.jobsByStatus?.QUEUED ?? 0)}
              valueClassName="font-mono text-sm"
            />
            <TwoLineMiniCard
              title={t("common.statusValues.running")}
              titleRight={<Spinner className="size-4" aria-hidden="true" />}
              value={String(batch?.jobsByStatus?.RUNNING ?? 0)}
              valueClassName="font-mono text-sm"
            />
            <TwoLineMiniCard
              title={t("common.statusValues.succeeded")}
              titleRight={<CheckCircle2 className="size-4" aria-hidden="true" />}
              value={String(batch?.jobsByStatus?.SUCCEEDED ?? 0)}
              valueClassName="font-mono text-sm"
            />
            <TwoLineMiniCard
              title={t("common.statusValues.failed")}
              titleRight={<XCircle className="size-4" aria-hidden="true" />}
              value={String(batch?.jobsByStatus?.FAILED ?? 0)}
              valueClassName="font-mono text-sm"
            />
            <TwoLineMiniCard
              title={t("common.statusValues.canceled")}
              titleRight={<Ban className="size-4" aria-hidden="true" />}
              value={String(batch?.jobsByStatus?.CANCELED ?? 0)}
              valueClassName="font-mono text-sm"
            />
            <TwoLineMiniCard
              title={t("common.statusValues.paused")}
              titleRight={<PauseCircle className="size-4" aria-hidden="true" />}
              value={String(batch?.jobsByStatus?.PAUSED ?? 0)}
              valueClassName="font-mono text-sm"
            />
            <TwoLineMiniCard
              title={t("common.duration")}
              titleRight={<Clock3 className="size-4" aria-hidden="true" />}
              value={durationMs == null ? "—" : formatDurationMs(durationMs)}
              valueClassName="font-mono text-sm"
            />
          </div>
        </SectionCardBody>
      </SectionCard>

      {/* Fan-out */}
      <div className="grid gap-3 xl:grid-cols-2">
        <SectionCard className="flex-none text-card-foreground">
          <SectionCardHeader>
            <div className="text-sm font-medium">{t("common.settings")}</div>
          </SectionCardHeader>
          <SectionCardBody className="p-3 space-y-4">
            {/* B-mode: show a quick read-only summary, then the editable controls below */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <TwoLineMiniCard
                title={t("common.pinnedWorkflowVersion")}
                titleRight={<WorkflowIcon className="size-4" aria-hidden="true" />}
                value={pinnedSummary}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("batches.concurrencyLimit")}
                value={concurrencySummary}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard title={t("batches.failurePolicy")} value={failPolicySummary} valueClassName="text-sm" />
              <TwoLineMiniCard title={urlFilesUi.title} value={urlCountSummary} valueClassName="font-mono text-sm" />
              <TwoLineMiniCard
                title={t("batches.sourceJson")}
                value={sourceConfiguredSummary}
                valueClassName="text-sm"
              />
            </div>

            {locked ? <div className="text-xs text-muted-foreground">{t("batches.pinnedHint")}</div> : null}
            <Separator />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <FieldLabelWithHelp
                  label={t("common.pinnedWorkflowVersion")}
                  tooltip={t("batches.pinnedHint")}
                  htmlFor="batch-pinned-mode"
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select
                    value={pinnedMode}
                    onValueChange={(v) => {
                      setSettingsTouched(true)
                      setPinnedMode(v as "LATEST" | "PINNED")
                    }}
                    disabled={loading || !batch || locked}
                  >
                    <SelectTrigger id="batch-pinned-mode" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LATEST">{t("batches.pinnedModeLatest")}</SelectItem>
                      <SelectItem value="PINNED">{t("batches.pinnedModePinned")}</SelectItem>
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
                      setSettingsTouched(true)
                      if (v === "__none") setPinnedWorkflowVersionNumber(null)
                      else setPinnedWorkflowVersionNumber(Number(v))
                    }}
                    disabled={
                      loading || !batch || locked || pinnedMode !== "PINNED" || versionsLoading || versions.length === 0
                    }
                  >
                    <SelectTrigger id="batch-pinned-version" className="w-full">
                      <SelectValue placeholder={t("batches.pinnedSelectPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {versions.length === 0 ? (
                        <SelectItem value="__none" disabled>
                          {t("batches.pinnedNoVersions")}
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

              <div className="grid gap-2">
                <FieldLabelWithHelp
                  label={t("batches.concurrencyLimit")}
                  tooltip={t("batches.concurrencyLimitHint")}
                  htmlFor="batch-concurrency-limit"
                />
                <Input
                  id="batch-concurrency-limit"
                  type="number"
                  min={1}
                  max={10_000}
                  value={concurrencyLimitDraft == null ? "" : String(concurrencyLimitDraft)}
                  onChange={(e) => {
                    setSettingsTouched(true)
                    const raw = e.target.value
                    if (!raw.trim()) {
                      setConcurrencyLimitDraft(null)
                      return
                    }
                    const n = Number(raw)
                    setConcurrencyLimitDraft(Number.isFinite(n) ? Math.max(1, Math.min(10_000, Math.floor(n))) : null)
                  }}
                  // Concurrency is an operational knob: allow edits even after fanout.
                  disabled={loading || !batch}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <FieldLabelWithHelp
                  label={t("batches.rampUpSeconds")}
                  tooltip={t("batches.rampUpSecondsHint")}
                  htmlFor="batch-ramp-up-seconds"
                />
                <Input
                  id="batch-ramp-up-seconds"
                  type="number"
                  min={1}
                  max={86_400}
                  value={rampUpSecondsDraft == null ? "" : String(rampUpSecondsDraft)}
                  onChange={(e) => {
                    setSettingsTouched(true)
                    const raw = e.target.value
                    if (!raw.trim()) {
                      setRampUpSecondsDraft(null)
                      return
                    }
                    const n = Number(raw)
                    setRampUpSecondsDraft(Number.isFinite(n) ? Math.max(1, Math.min(86_400, Math.floor(n))) : null)
                  }}
                  disabled={loading || !batch}
                />
              </div>
              <div className="grid gap-2">
                <FieldLabelWithHelp
                  label={t("batches.autoMaxConcurrency")}
                  tooltip={t("batches.autoMaxConcurrencyHint")}
                  htmlFor="batch-auto-max-concurrency"
                />
                <Input
                  id="batch-auto-max-concurrency"
                  type="number"
                  min={1}
                  max={10_000}
                  value={autoMaxConcurrencyDraft == null ? "" : String(autoMaxConcurrencyDraft)}
                  onChange={(e) => {
                    setSettingsTouched(true)
                    const raw = e.target.value
                    if (!raw.trim()) {
                      setAutoMaxConcurrencyDraft(null)
                      return
                    }
                    const n = Number(raw)
                    setAutoMaxConcurrencyDraft(Number.isFinite(n) ? Math.max(1, Math.min(10_000, Math.floor(n))) : null)
                  }}
                  disabled={loading || !batch}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <FieldLabelWithHelp
                  label={t("batches.failurePolicy")}
                  tooltip={t("batches.failurePolicyHint")}
                  htmlFor="batch-failure-policy"
                />
                <Select
                  value={failFastDraft ? "FAIL_FAST" : maxFailuresDraft != null ? "MAX_FAILURES" : "NONE"}
                  onValueChange={(v) => {
                    setSettingsTouched(true)
                    if (v === "NONE") {
                      setFailFastDraft(false)
                      setMaxFailuresDraft(null)
                      return
                    }
                    if (v === "FAIL_FAST") {
                      setFailFastDraft(true)
                      setMaxFailuresDraft(null)
                      return
                    }
                    if (v === "MAX_FAILURES") {
                      setFailFastDraft(false)
                      setMaxFailuresDraft((prev) => (prev == null ? 1 : prev))
                    }
                  }}
                  disabled={loading || !batch || locked}
                >
                  <SelectTrigger id="batch-failure-policy" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">{t("common.notConfigured")}</SelectItem>
                    <SelectItem value="FAIL_FAST">{t("batches.failurePolicyModeFailFast")}</SelectItem>
                    <SelectItem value="MAX_FAILURES">{t("batches.failurePolicyModeMaxFailures")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <FieldLabelWithHelp
                  label={t("batches.maxFailures")}
                  tooltip={t("batches.maxFailuresHint")}
                  htmlFor="batch-max-failures"
                />
                <Input
                  id="batch-max-failures"
                  type="number"
                  min={1}
                  max={10_000}
                  value={maxFailuresDraft == null ? "" : String(maxFailuresDraft)}
                  onChange={(e) => {
                    setSettingsTouched(true)
                    const raw = e.target.value
                    if (!raw.trim()) {
                      setMaxFailuresDraft(null)
                      return
                    }
                    const n = Number(raw)
                    setMaxFailuresDraft(Number.isFinite(n) ? Math.max(1, Math.min(10_000, Math.floor(n))) : null)
                  }}
                  disabled={loading || !batch || locked || maxFailuresDraft == null}
                  placeholder={maxFailuresDraft == null ? t("common.notConfigured") : undefined}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <FieldLabelWithHelp
                label={t("batches.sourceJson")}
                tooltip={t("batches.sourceJsonHint")}
                htmlFor="batch-source-json"
              />
              <TextareaWithChrome
                id="batch-source-json"
                value={sourceJsonDraft}
                onChange={(e) => {
                  setSettingsTouched(true)
                  setSourceJsonDraft(e.target.value ?? "")
                }}
                rows={6}
                className="font-mono text-xs max-h-64"
                placeholder={t("batches.sourceJsonPlaceholder")}
                disabled={loading || !batch}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void saveSettings()}
                disabled={loading || !batch || !settingsTouched}
              >
                <Save className="size-4" aria-hidden="true" />
                {t("common.saveAction")}
              </Button>
            </div>
          </SectionCardBody>
        </SectionCard>

        <SectionCard className="flex-none text-card-foreground">
          <SectionCardHeader>
            <div className="text-sm font-medium">{t("batches.fanoutTitle")}</div>
          </SectionCardHeader>
          <SectionCardBody className="p-3 space-y-3">
            {inputSpecLoading ? (
              <FanoutSectionInlineSkeleton />
            ) : inputSpecErr ? (
              <ErrorAlert titleKey="jobs.inputSpecInvalid" description={inputSpecErr} />
            ) : !inputSpec ? (
              <InfoAlert titleKey="common.noInputsTitle" descriptionKey="common.inputSpecMissingHint" />
            ) : !paramsEditorEnabled && !urlFilesEnabled ? (
              <InfoAlert titleKey="common.noInputsTitle" descriptionKey="common.noInputsDescription" />
            ) : (
              <>
                {paramsEditorEnabled ? (
                  <div className="grid gap-3">
                    {showFanoutIssues ? (
                      <ApiIssuesAlert
                        title={fanoutIssuesTitle}
                        issues={fanoutIssuesToShow}
                        onIssueClick={(iss) => {
                          const ed = seedJsonEditorRef.current
                          if (String(iss.keyword ?? "") === "json") {
                            focusJsonParseErrorInMonacoEditor(ed, iss.message)
                            return
                          }
                          const p = normalizeJsonPointer(iss.path)
                          focusJsonPointerInMonacoEditor(ed, p)
                        }}
                      />
                    ) : null}

                    <div className="grid gap-2">
                      <FieldLabelWithHelp
                        label={t("common.inputParams")}
                        tooltip={<RichTextI18n i18nKey="common.inputParamsHintRich" />}
                      />
                      <JsonMonacoEditor
                        title={undefined}
                        codeLabel={null}
                        editorRef={seedJsonEditorRef}
                        value={seedJsonText}
                        onChange={(v) => {
                          setSeedTouched(true)
                          setFanoutSubmitError(null)
                          setSeedJsonText(v)
                        }}
                        height={450}
                        disabled={fanoutSubmitting}
                        actions={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="h-6 w-6"
                            onClick={formatSeedJson}
                            disabled={fanoutSubmitting || !canFormatSeed}
                            aria-label={t("workflows.inputSpec.formatAction")}
                            title={t("workflows.inputSpec.formatAction")}
                          >
                            <Braces className="size-4" />
                          </Button>
                        }
                        showActionsOnHover
                      />
                    </div>
                  </div>
                ) : null}

                {urlFilesEnabled ? (
                  <div className="grid gap-2">
                    <UrlFilesEditor
                      title={urlFilesUi.title}
                      required={inputSpec?.filesInput?.urlFiles?.required === true}
                      codeLabel="urlFiles"
                      hintText={urlFilesUi.description}
                      rightSlot={
                        typeof urlMaxItems === "number" ? (
                          <Badge variant="outline" className="text-[10px]">
                            {t("jobs.limitCount", { count: fanoutUrlLines.length, max: urlMaxItems })}
                          </Badge>
                        ) : null
                      }
                      value={fanoutUrlList}
                      onChange={(raw) => setFanoutUrlList(raw)}
                      rows={4}
                      placeholder={"https://example.com/data.csv\nhttps://example.com/image.png"}
                      disabled={fanoutSubmitting || loading || !batch || locked}
                      headerClassName="flex items-start justify-between gap-3"
                      textareaClassName="font-mono text-xs"
                    />
                  </div>
                ) : null}
              </>
            )}

            {/* Sharding controls: only meaningful when seed JSON fanout (params) is enabled */}
            {paramsEditorEnabled ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <FieldLabelWithHelp
                    label={t("batches.shardCount")}
                    tooltip={t("batches.shardCountHint")}
                    labelClassName="text-sm"
                    htmlFor="batch-fanout-shard-count"
                  />
                  <Input
                    id="batch-fanout-shard-count"
                    type="number"
                    min={1}
                    max={10_000}
                    value={String(fanoutShardCount)}
                    onChange={(e) => {
                      const n = Number(e.target.value || 1)
                      const nextCount = Math.max(1, Math.min(10_000, Number.isFinite(n) ? Math.floor(n) : 1))
                      setFanoutShardCount(nextCount)
                      setFanoutShardIndex((prev) => Math.min(prev, Math.max(0, nextCount - 1)))
                    }}
                    disabled={fanoutSubmitting || loading || !batch || locked}
                  />
                </div>
                <div className="grid gap-1">
                  <FieldLabelWithHelp
                    label={t("batches.shardIndex")}
                    tooltip={t("batches.shardIndexHint")}
                    labelClassName="text-sm"
                    htmlFor="batch-fanout-shard-index"
                  />
                  <Input
                    id="batch-fanout-shard-index"
                    type="number"
                    min={0}
                    max={Math.max(0, Math.min(9_999, fanoutShardCount - 1))}
                    value={String(fanoutShardIndex)}
                    onChange={(e) => {
                      const n = Number(e.target.value || 0)
                      const maxIndex = Math.max(0, Math.min(9_999, fanoutShardCount - 1))
                      setFanoutShardIndex(Math.max(0, Math.min(maxIndex, Number.isFinite(n) ? Math.floor(n) : 0)))
                    }}
                    disabled={fanoutSubmitting || loading || !batch || locked}
                  />
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={fanoutStartNow}
                  onCheckedChange={(v) => setFanoutStartNow(Boolean(v))}
                  disabled={fanoutSubmitting}
                />
                <span>{t("batches.fanoutStartNowAction")}</span>
              </label>
              <Button size="sm" onClick={submitFanout} disabled={fanoutSubmitting || loading || !batch || locked}>
                {fanoutSubmitting ? (
                  <Spinner className="size-4" aria-hidden="true" />
                ) : (
                  <Layers className="size-4" aria-hidden="true" />
                )}
                {t("batches.fanoutEnqueueAction")}
              </Button>
            </div>
          </SectionCardBody>
        </SectionCard>
      </div>

      {/* Jobs */}
      {jobsErr ? <ErrorAlert titleKey="common.loadFailed" error={jobsErr} /> : null}
      <StandardListPage<JobsListItemModel>
        title={t("batches.jobs")}
        description={undefined}
        search={{
          value: search,
          placeholder: t("jobs.searchPlaceholder"),
          inputRef: searchInputRef,
          onChange: setSearch,
          onReset: () => {
            setSearch("")
            setPageIndex(0)
          },
        }}
        mobileBar={{
          left: (
            <div className="text-sm font-medium text-muted-foreground md:hidden">
              {t("jobs.showingTotal", { total: jobsTotal })}
            </div>
          ),
        }}
        listHeader={{
          left: <div className="hidden md:block">{t("jobs.showingTotal", { total: jobsTotal })}</div>,
          right: (
            <div className="w-full md:w-auto">
              {renderFilters({ className: "justify-start md:justify-end", disabled: jobsLoading || jobsRefreshing })}
            </div>
          ),
        }}
        emptyState={{
          loading: jobsLoading,
          filtersActive,
          empty: t("jobs.emptyState"),
          noResultsTitle: t("jobs.noResultsTitle"),
          noResultsDescription: t("common.list.noResultsDescription"),
          clearFiltersLabel: t("common.filters.clearAction"),
          onClearFilters: clearFilters,
        }}
        list={{
          items: listItems,
          getRowKey: (it) => it.id,
          renderSkeleton: (idx) => <CommonListItemSkeleton key={`skwrap:${idx}`} />,
          renderRow: (it) => (
            <JobsCommonListItem
              key={it.id}
              locale={locale}
              model={it}
              href={`/jobs/${it.id}`}
              formatDurationMs={formatDurationMs}
              statusLabel={statusLabel}
              showActions={false}
            />
          ),
        }}
        pagination={{
          pageIndex: safePageIndex,
          totalPages,
          onPageIndexChange: setPageIndex,
          compactOnMobile: true,
          previousLabel: t("common.prevPageAction"),
          nextLabel: t("common.nextPageAction"),
        }}
      />
    </DetailPageLayout>
  )
}
