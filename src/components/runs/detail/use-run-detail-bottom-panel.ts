"use client"

import * as React from "react"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"

import { useTopicStream } from "@/hooks/use-topic-stream"
import { ApiError, apiFetchJson } from "@/lib/shared/http/api"
import { isRecord } from "@/lib/shared/lang/is-record"
import { makeStreamTopic } from "@/lib/shared/realtime/topics"
import { toCanonicalRunStatus } from "@/lib/shared/run-status"
import { normalizeFilenameStem } from "@/lib/shared/filename"

type InputFileRow = {
  id: string
  name: string
  source: string
  status: string
  url: string | null
  error: string | null
  sha256: string | null
  sizeBytes: number | null
  mime: string | null
}

function inputFileToFileViewerModel(runId: string, f: InputFileRow, fileFallbackName: string) {
  const name = f?.name ? String(f.name) : fileFallbackName
  const status = String(f?.status ?? "")
  const statusLower = status.toLowerCase()
  const source = String(f?.source ?? "").toLowerCase()
  const url = f?.url ? String(f.url) : null
  const error = f?.error ? String(f.error) : null

  // Deterministic materialized path under runDir/uploads (matches server-side sanitize logic).
  const relPath = `uploads/${String(f.id)}-${normalizeFilenameStem(name, { fallback: "file", maxLen: 120 })}`
  const downloadHref =
    runId && statusLower === "ready"
      ? `/api/runs/${encodeURIComponent(runId)}/files/download?path=${encodeURIComponent(relPath)}&name=${encodeURIComponent(name)}`
      : source === "url"
        ? null
        : url

  const canDownload = statusLower !== "fetching" && statusLower !== "failed" && !!downloadHref
  return {
    id: f.id,
    name,
    path: statusLower === "ready" ? relPath : null,
    url,
    source,
    status: statusLower,
    error,
    downloadHref,
    downloadDisabled: !canDownload,
    onRetryDownload: null,
    retryDisabled: true,
  }
}

type Attempt = {
  stepKey: string
  attemptNo: number
  status: string
  exitCode: number | null
  errorCode: string | null
  errorMessage: string | null
  errorMetaJson: string | null
  errorAt: string | null
  startedAt: string | null
  finishedAt: string | null
}

type RunOutputsResponse = {
  outputs: Record<string, unknown> | null
  spec?: unknown
  sources?: Record<string, { stepKey: string; field?: string; attemptNo: number | null }>
  error?: string | null
}

type ArtifactRow = {
  id: string
  artifactInternalId?: string
  runId: string
  stepKey: string
  attemptNo: number
  kind: string
  path: string
  sizeBytes: number | null
  sha256: string | null
  summary: string | null
  createdAt: string
}

export type StepDefinitionPayload =
  | {
      available: true
      code: null
      run: {
        id: string
        workflowId: string
        workflowName: string
        workflowVersionNumber: number | null
        depsHash: string | null
        depsPackagesCount: number | null
      }
      step: {
        stepKey: string
        name: string
        deps: string[]
        timeoutMs: number
        scriptEsm: string
      }
    }
  | { available: false; code: string; run: null; step: null }

export function useRunDetailBottomPanelData(args: {
  runId: string
  selectedStepKey: string | null
  effectiveRunStatus: string
  stream: {
    selectedLogs: (stepKey: string | null) => unknown[]
    stepStatusByKey: Record<string, { status: string; attemptNo?: number }>
  }

  runTab: "runInputs" | "artifacts" | "step" | "summary"
  stepTab: "logs" | "stepInput" | "stepOutput" | "stepDefinition" | "attempts"

  fileFallbackName: string
  stepNameByKey?: Record<string, string>
  artifactKindLabelByKind?: Record<string, string>
  formatAttemptShort?: (attemptNo: number) => string
}) {
  const queryClient = useQueryClient()

  const runInputsQueryKey = React.useMemo(() => ["run", args.runId, "inputs"] as const, [args.runId])
  const runInputsQuery = useQuery({
    queryKey: runInputsQueryKey,
    enabled: args.runTab === "runInputs",
    queryFn: async ({ signal }) => {
      try {
        const body = await apiFetchJson<unknown>(`/api/runs/${encodeURIComponent(args.runId)}/inputs`, {
          cache: "no-store",
          signal,
        })
        const b = isRecord(body) ? body : null
        const available = b?.available !== false && typeof b?.initialInput === "string"
        if (!available) {
          return {
            available: false as const,
            code: (typeof b?.code === "string" ? String(b.code) : "NO_RUN_INPUTS") as string,
            obj: null as null,
          }
        }
        const raw = typeof b?.initialInput === "string" ? String(b.initialInput) : null
        let obj: unknown = null
        try {
          obj = raw ? JSON.parse(raw) : null
        } catch {
          obj = null
        }
        return { available: true as const, code: null as null, obj }
      } catch (e) {
        // Prefer a stable "not available" shape over throwing (this panel is optional UI).
        if (e instanceof ApiError) return { available: false as const, code: e.code, obj: null as null }
        throw e
      }
    },
    placeholderData: keepPreviousData,
  })

  const runInputFilesQueryKey = React.useMemo(() => ["run", args.runId, "input-files"] as const, [args.runId])
  const runInputFilesQuery = useQuery({
    queryKey: runInputFilesQueryKey,
    enabled: args.runTab === "runInputs",
    queryFn: async ({ signal }) => {
      try {
        const body = await apiFetchJson<unknown>(`/api/runs/${encodeURIComponent(args.runId)}/input-files`, {
          cache: "no-store",
          signal,
        })
        const b = isRecord(body) ? body : null
        const filesRaw = b?.inputFiles
        const inputFiles = Array.isArray(filesRaw) ? (filesRaw as unknown[]) : []
        return inputFiles
          .map((f) => (isRecord(f) ? f : null))
          .filter((x): x is Record<string, unknown> => x != null)
          .map((f) => ({
            id: String(f.id ?? ""),
            name: String(f.name ?? ""),
            source: String(f.source ?? ""),
            status: String(f.status ?? ""),
            url: typeof f.url === "string" ? String(f.url) : null,
            error: typeof f.error === "string" ? String(f.error) : null,
            sha256: typeof f.sha256 === "string" ? String(f.sha256) : null,
            sizeBytes: typeof f.sizeBytes === "number" ? f.sizeBytes : null,
            mime: typeof f.mime === "string" ? String(f.mime) : null,
          }))
          .filter((f) => !!f.id)
      } catch (e) {
        if (e instanceof ApiError) return [] as InputFileRow[]
        throw e
      }
    },
    placeholderData: keepPreviousData,
  })

  const runOutputsQuery = useQuery({
    queryKey: ["run", args.runId, "outputs"],
    enabled: args.runTab === "artifacts",
    queryFn: async ({ signal }) => {
      try {
        return await apiFetchJson<RunOutputsResponse>(`/api/runs/${encodeURIComponent(args.runId)}/outputs`, {
          cache: "no-store",
          signal,
        })
      } catch (e) {
        if (e instanceof ApiError) return { outputs: null, error: e.code } as RunOutputsResponse
        throw e
      }
    },
    placeholderData: keepPreviousData,
  })

  const artifactsQuery = useQuery({
    queryKey: ["run", args.runId, "artifacts"],
    enabled: args.runTab === "artifacts",
    queryFn: async ({ signal }) => {
      try {
        const body = await apiFetchJson<{ artifacts?: ArtifactRow[] }>(
          `/api/runs/${encodeURIComponent(args.runId)}/artifacts`,
          {
            cache: "no-store",
            signal,
          },
        )
        return Array.isArray(body?.artifacts) ? body.artifacts : ([] as ArtifactRow[])
      } catch (e) {
        if (e instanceof ApiError) return [] as ArtifactRow[]
        throw e
      }
    },
    placeholderData: keepPreviousData,
  })

  const stepKey = args.selectedStepKey
  const stepEnabled = args.runTab === "step" && !!stepKey
  const stepInputEnabled = stepEnabled && args.stepTab === "stepInput"
  const stepOutputEnabled = stepEnabled && args.stepTab === "stepOutput"
  const stepDefEnabled = stepEnabled && args.stepTab === "stepDefinition"
  const attemptsEnabled = stepEnabled && args.stepTab === "attempts"
  // Step artifacts are needed for both Step Input (input.json) and Step Output (output.json + files).
  const stepArtifactsEnabled = stepOutputEnabled || stepInputEnabled

  const stepInputQuery = useQuery({
    queryKey: ["run", args.runId, "step", stepKey, "input"],
    enabled: stepInputEnabled,
    queryFn: async ({ signal }) => {
      try {
        const body = await apiFetchJson<unknown>(
          `/api/runs/${encodeURIComponent(args.runId)}/steps/${encodeURIComponent(String(stepKey))}/input`,
          { cache: "no-store", signal },
        )
        const b = isRecord(body) ? body : null
        const available = b?.available !== false && b?.input != null
        if (available) return { available: true as const, code: null as null, value: b?.input ?? null }
        return {
          available: false as const,
          code: (typeof b?.code === "string" ? String(b.code) : "NO_STEP_INPUT") as string,
          value: null,
        }
      } catch (e) {
        if (e instanceof ApiError) return { available: false as const, code: e.code, value: null }
        throw e
      }
    },
    placeholderData: keepPreviousData,
  })

  const stepOutputQuery = useQuery({
    queryKey: ["run", args.runId, "step", stepKey, "output"],
    enabled: stepOutputEnabled,
    queryFn: async ({ signal }) => {
      try {
        const body = await apiFetchJson<unknown>(
          `/api/runs/${encodeURIComponent(args.runId)}/steps/${encodeURIComponent(String(stepKey))}/output`,
          { cache: "no-store", signal },
        )
        const b = isRecord(body) ? body : null
        const available = b?.available !== false && b?.output != null
        if (available) return { available: true as const, code: null as null, value: b?.output ?? null }
        return {
          available: false as const,
          code: (typeof b?.code === "string" ? String(b.code) : "NO_STEP_OUTPUT") as string,
          value: null,
        }
      } catch (e) {
        if (e instanceof ApiError) return { available: false as const, code: e.code, value: null }
        throw e
      }
    },
    placeholderData: keepPreviousData,
  })

  const stepDefinitionQuery = useQuery({
    queryKey: ["run", args.runId, "step", stepKey, "definition"],
    enabled: stepDefEnabled,
    queryFn: async ({ signal }) => {
      try {
        const body = await apiFetchJson<StepDefinitionPayload>(
          `/api/runs/${encodeURIComponent(args.runId)}/steps/${encodeURIComponent(String(stepKey))}/definition`,
          { cache: "no-store", signal },
        )
        if (body?.available === true) return body
        const code = typeof body?.code === "string" ? String(body.code) : "NO_STEP_DEFINITION"
        return { available: false, code, run: null, step: null } as StepDefinitionPayload
      } catch (e) {
        if (e instanceof ApiError)
          return { available: false, code: e.code, run: null, step: null } as StepDefinitionPayload
        throw e
      }
    },
    placeholderData: keepPreviousData,
  })

  const attemptsQuery = useQuery({
    queryKey: ["run", args.runId, "step", stepKey, "attempts"],
    enabled: attemptsEnabled,
    queryFn: async ({ signal }) => {
      try {
        const body = await apiFetchJson<{ attempts?: Attempt[] }>(
          `/api/runs/${encodeURIComponent(args.runId)}/attempts?stepKey=${encodeURIComponent(String(stepKey))}`,
          { cache: "no-store", signal },
        )
        return Array.isArray(body?.attempts) ? body.attempts : []
      } catch (e) {
        if (e instanceof ApiError) return []
        throw e
      }
    },
    placeholderData: keepPreviousData,
  })

  const stepArtifactsQuery = useQuery({
    queryKey: ["run", args.runId, "step", stepKey, "artifacts"],
    enabled: stepArtifactsEnabled,
    queryFn: async ({ signal }) => {
      try {
        const body = await apiFetchJson<{ artifacts?: ArtifactRow[] }>(
          `/api/runs/${encodeURIComponent(args.runId)}/steps/${encodeURIComponent(String(stepKey))}/artifacts`,
          { cache: "no-store", signal },
        )
        return Array.isArray(body?.artifacts) ? body.artifacts : ([] as ArtifactRow[])
      } catch (e) {
        if (e instanceof ApiError) return [] as ArtifactRow[]
        throw e
      }
    },
    placeholderData: keepPreviousData,
  })

  const runOutputs = runOutputsQuery.data ?? null
  const runOutputsLoaded = runOutputsQuery.isFetched
  const artifacts = artifactsQuery.data ?? null
  const artifactsLoaded = artifactsQuery.isFetched

  // Subscribe to run-level SSE for input file status updates (same topic as logs/status).
  // This keeps the "Run Inputs -> File" list live without requiring a refresh button.
  useTopicStream({
    topic: args.runId ? makeStreamTopic("run", args.runId) : null,
    enabled: !!args.runId,
    persistCursor: false,
    onMessage: (msg) => {
      const type = String(msg.type || "")
      if (type !== "input_file_status") return
      const d = msg.data && typeof msg.data === "object" ? (msg.data as Record<string, unknown>) : null
      if (!d) return
      if (String(d.runId ?? "") !== String(args.runId)) return
      const fileId = String(d.fileId ?? "")
      if (!fileId) return

      // Patch SSOT input-files query cache (preferred display).
      queryClient.setQueryData(runInputFilesQueryKey, (prev) => {
        const list = Array.isArray(prev) ? (prev as InputFileRow[]) : []
        const idx = list.findIndex((x) => String(x?.id ?? "") === fileId)
        if (idx < 0) return prev
        const cur = list[idx]
        const nextStatus = typeof d.status === "string" ? String(d.status).toUpperCase() : String(cur.status ?? "")
        const patch: Partial<InputFileRow> = {
          status: nextStatus,
          // error is only meaningful for FAILED. Keep null otherwise.
          error: typeof d.error === "string" ? String(d.error) : d.error === null ? null : cur.error,
          sha256: typeof d.sha256 === "string" ? String(d.sha256) : d.sha256 === null ? null : cur.sha256,
          sizeBytes: typeof d.sizeBytes === "number" ? d.sizeBytes : d.sizeBytes === null ? null : cur.sizeBytes,
          mime: typeof d.mime === "string" ? String(d.mime) : d.mime === null ? null : cur.mime,
        }
        const next = [...list]
        next[idx] = { ...cur, ...patch }
        return next
      })

      queryClient.setQueryData(runInputsQueryKey, (prev) => {
        if (!isRecord(prev)) return prev
        const obj = prev.obj
        if (!isRecord(obj)) return prev
        const filesVal = obj.files
        const files = Array.isArray(filesVal) ? [...filesVal] : []
        const idx = files.findIndex((f) => (isRecord(f) ? String(f.id ?? "") : "") === fileId)
        if (idx < 0) return prev
        const cur = (files[idx] && isRecord(files[idx]) ? (files[idx] as Record<string, unknown>) : {}) as Record<
          string,
          unknown
        >
        files[idx] = {
          ...cur,
          status: typeof d.status === "string" ? String(d.status) : cur.status,
          path: typeof d.path === "string" ? String(d.path) : d.path === null ? undefined : cur.path,
          error: typeof d.error === "string" ? String(d.error) : d.error === null ? undefined : cur.error,
          sizeBytes: typeof d.sizeBytes === "number" ? d.sizeBytes : d.sizeBytes === null ? undefined : cur.sizeBytes,
          sha256: typeof d.sha256 === "string" ? String(d.sha256) : d.sha256 === null ? undefined : cur.sha256,
          mime: typeof d.mime === "string" ? String(d.mime) : d.mime === null ? undefined : cur.mime,
        }
        return { ...prev, obj: { ...obj, files } }
      })
    },
  })

  // Attempt auto-refresh policy (bounded & stable): only refetch when SSE indicates it's needed.
  React.useEffect(() => {
    if (!attemptsEnabled) return
    if (!stepKey) return
    const cached = attemptsQuery.data

    const cachedMaxAttemptNo = cached && cached.length ? Math.max(...cached.map((a) => Number(a.attemptNo ?? 0))) : 0
    const cachedMaxAttempt =
      cached && cached.length ? (cached.find((a) => Number(a.attemptNo ?? 0) === cachedMaxAttemptNo) ?? null) : null
    const cachedMaxStatus = cachedMaxAttempt ? toCanonicalRunStatus(String(cachedMaxAttempt.status ?? "")) : ""

    const liveAttemptNo = Number(args.stream.stepStatusByKey?.[stepKey]?.attemptNo ?? 0)
    const liveStepStatus = toCanonicalRunStatus(String(args.stream.stepStatusByKey?.[stepKey]?.status ?? ""))
    const liveRunStatus = toCanonicalRunStatus(String(args.effectiveRunStatus ?? ""))

    const shouldRefetch =
      cached === undefined ||
      (Number.isFinite(liveAttemptNo) && liveAttemptNo > cachedMaxAttemptNo) ||
      (cachedMaxStatus === "RUNNING" &&
        (liveStepStatus === "FAILED" || liveStepStatus === "CANCELED" || liveStepStatus === "SUCCEEDED")) ||
      (cachedMaxStatus === "RUNNING" &&
        (liveRunStatus === "FAILED" || liveRunStatus === "CANCELED" || liveRunStatus === "SUCCEEDED"))

    if (!shouldRefetch) return
    void attemptsQuery.refetch()
  }, [attemptsEnabled, stepKey, attemptsQuery, args.stream.stepStatusByKey, args.effectiveRunStatus])

  // Derive file inputs for FileViewer (must be computed without hooks; this component can early-return while loading).
  const initialInputObjForView: unknown = runInputsQuery.data?.obj ?? null
  const inputFiles: InputFileRow[] = Array.isArray(runInputFilesQuery.data) ? (runInputFilesQuery.data as InputFileRow[]) : []
  const initialInputParams = (() => {
    if (!isRecord(initialInputObjForView)) return {}
    const next: Record<string, unknown> = { ...initialInputObjForView }
    // `files` is system-managed; show it separately in the file inputs table.
    delete next.files
    return next
  })()
  const hasInitialParams =
    initialInputParams && typeof initialInputParams === "object" && Object.keys(initialInputParams).length > 0

  const fileViewerFiles = (inputFiles ?? []).map((f) => inputFileToFileViewerModel(args.runId, f, args.fileFallbackName))

  const artifactViewerFiles = (artifacts ?? []).map((a) => {
    const base =
      String(a.path ?? "")
        .split("/")
        .pop() || "artifact"
    const internalId = String(a.artifactInternalId ?? a.id ?? "")
    const downloadHref = `/api/runs/${encodeURIComponent(args.runId)}/artifacts/download?artifactInternalId=${encodeURIComponent(internalId)}&name=${encodeURIComponent(base)}`
    const stepKey = typeof a.stepKey === "string" ? String(a.stepKey) : ""
    const stepDisplay = (stepKey && args.stepNameByKey?.[stepKey]) || (stepKey ? stepKey : "—")
    const kind = String(a.kind ?? "artifact")
    const baseLower = base.toLowerCase()
    const kindLower = kind.toLowerCase()
    const hideBase = baseLower === `${kindLower}.json` && (kindLower === "input" || kindLower === "output")
    const kindLabel = args.artifactKindLabelByKind?.[kindLower] ?? kind
    const attemptNo = Number(a.attemptNo ?? 0)
    const attemptLabel =
      Number.isFinite(attemptNo) && attemptNo > 0
        ? args.formatAttemptShort
          ? args.formatAttemptShort(attemptNo)
          : `#${attemptNo}`
        : "—"
    const name = `${stepDisplay} · ${kindLabel} · ${attemptLabel}${hideBase ? "" : ` · ${base}`}`
    const titleIcon: "input" | "output" | null =
      kindLower === "input" ? "input" : kindLower === "output" ? "output" : null
    return {
      id: a.id,
      name,
      downloadName: base,
      titleIcon,
      path: String(a.path ?? ""),
      url: null,
      source: null,
      status: "ready",
      error: null,
      downloadHref,
      downloadDisabled: false,
      onRetryDownload: null,
      retryDisabled: true,
    }
  })

  const deliverableArtifactViewerFiles = (artifacts ?? [])
    .filter((a) => {
      const kind = String(a?.kind ?? "").toLowerCase()
      // Artifacts tab only focuses on "real deliverables" (exclude system IO artifacts).
      return kind !== "input" && kind !== "output"
    })
    .map((a) => {
      const base =
        String(a.path ?? "")
          .split("/")
          .pop() || "artifact"
      const internalId = String(a.artifactInternalId ?? a.id ?? "")
      const downloadHref = `/api/runs/${encodeURIComponent(args.runId)}/artifacts/download?artifactInternalId=${encodeURIComponent(internalId)}&name=${encodeURIComponent(base)}`
      const stepKey = typeof a.stepKey === "string" ? String(a.stepKey) : ""
      const stepDisplay = (stepKey && args.stepNameByKey?.[stepKey]) || (stepKey ? stepKey : "—")
      const kind = String(a.kind ?? "artifact")
      const kindLower = kind.toLowerCase()
      const kindLabel = args.artifactKindLabelByKind?.[kindLower] ?? kind
      const attemptNo = Number(a.attemptNo ?? 0)
      const attemptLabel =
        Number.isFinite(attemptNo) && attemptNo > 0
          ? args.formatAttemptShort
            ? args.formatAttemptShort(attemptNo)
            : `#${attemptNo}`
          : "—"
      const name = `${stepDisplay} · ${kindLabel} · ${attemptLabel} · ${base}`
      return {
        id: a.id,
        name,
        downloadName: base,
        titleIcon: null as "input" | "output" | null,
        path: String(a.path ?? ""),
        url: null,
        source: null,
        status: "ready",
        error: null,
        downloadHref,
        downloadDisabled: false,
        onRetryDownload: null,
        retryDisabled: true,
      }
    })

  const stepArtifactViewerFiles = (stepArtifactsQuery.data ?? []).map((a) => {
    const base =
      String(a.path ?? "")
        .split("/")
        .pop() || "artifact"
    const internalId = String(a.artifactInternalId ?? a.id ?? "")
    const downloadHref = `/api/runs/${encodeURIComponent(args.runId)}/artifacts/download?artifactInternalId=${encodeURIComponent(internalId)}&name=${encodeURIComponent(base)}`
    const kind = String(a.kind ?? "artifact")
    const kindLower = kind.toLowerCase()
    const hideBase = base.toLowerCase() === `${kindLower}.json` && (kindLower === "input" || kindLower === "output")
    const kindLabel = args.artifactKindLabelByKind?.[kindLower] ?? kind
    const attemptNo = Number(a.attemptNo ?? 0)
    const attemptLabel =
      Number.isFinite(attemptNo) && attemptNo > 0
        ? args.formatAttemptShort
          ? args.formatAttemptShort(attemptNo)
          : `#${attemptNo}`
        : "—"
    const name = `${kindLabel} · ${attemptLabel}${hideBase ? "" : ` · ${base}`}`
    const titleIcon: "input" | "output" | null =
      kindLower === "input" ? "input" : kindLower === "output" ? "output" : null
    return {
      id: a.id,
      name,
      downloadName: base,
      titleIcon,
      path: String(a.path ?? ""),
      url: null,
      source: null,
      status: "ready",
      error: null,
      downloadHref,
      downloadDisabled: false,
      onRetryDownload: null,
      retryDisabled: true,
    }
  })

  // Step input tab shows input.json only (kind=input).
  const stepInputArtifactViewerFiles = stepArtifactViewerFiles.filter((f) => f.titleIcon === "input")

  // Step output tab shows output.json (kind=output) + user files (kind=file).
  // It intentionally excludes input.json (kind=input) to avoid confusing users.
  const stepOutputArtifactViewerFiles = stepArtifactViewerFiles.filter((f) => f.titleIcon !== "input")

  const selectedStepStatus = React.useMemo(() => {
    const k = args.selectedStepKey
    if (!k) return null
    const s = args.stream.stepStatusByKey?.[k]?.status
    return typeof s === "string" && s ? s : null
  }, [args.selectedStepKey, args.stream.stepStatusByKey])

  const inputJson = stepInputQuery.data?.available ? stepInputQuery.data.value : null
  const inputJsonLoaded = stepInputQuery.isFetched
  const inputJsonCode = stepInputQuery.data?.available === false ? stepInputQuery.data.code : null

  const outputJson = stepOutputQuery.data?.available ? stepOutputQuery.data.value : null
  const outputJsonLoaded = stepOutputQuery.isFetched
  const outputJsonCode = stepOutputQuery.data?.available === false ? stepOutputQuery.data.code : null

  const stepDefByStepKey: Record<string, StepDefinitionPayload> = {}
  const stepDefLoadingByStepKey: Record<string, boolean> = {}
  if (stepKey) {
    if (stepDefinitionQuery.data) stepDefByStepKey[stepKey] = stepDefinitionQuery.data
    stepDefLoadingByStepKey[stepKey] = stepDefinitionQuery.isLoading || stepDefinitionQuery.isFetching
  }
  const selectedStepDef =
    stepKey && stepDefinitionQuery.data && stepDefinitionQuery.data.available === true ? stepDefinitionQuery.data : null

  const attemptsByStepKey: Record<string, Attempt[]> = {}
  if (stepKey && Array.isArray(attemptsQuery.data)) attemptsByStepKey[stepKey] = attemptsQuery.data

  return {
    // Artifacts
    runOutputs,
    runOutputsLoaded,
    artifacts,
    artifactsLoaded,
    artifactViewerFiles,
    deliverableArtifactViewerFiles,
    artifactsLoading: runOutputsQuery.isLoading || artifactsQuery.isLoading,
    artifactsFetching: runOutputsQuery.isFetching || artifactsQuery.isFetching,

    // Run Inputs
    initialInputCode: runInputsQuery.data?.available === false ? runInputsQuery.data.code : null,
    hasInitialParams,
    inputFiles,
    initialInputParams,
    fileViewerFiles,
    runInputsLoading: runInputsQuery.isLoading || runInputFilesQuery.isLoading,
    runInputsFetching: runInputsQuery.isFetching || runInputFilesQuery.isFetching,

    // Step Definition
    stepDefByStepKey,
    stepDefLoadingByStepKey,
    selectedStepDef,
    stepDefinitionLoading: stepDefinitionQuery.isLoading,

    // Step IO
    inputJson,
    inputJsonLoaded,
    inputJsonCode,
    outputJson,
    outputJsonLoaded,
    outputJsonCode,
    stepInputLoading: stepInputQuery.isLoading || stepInputQuery.isFetching,
    stepOutputLoading: stepOutputQuery.isLoading || stepOutputQuery.isFetching,

    // Step Artifacts
    stepInputArtifactViewerFiles,
    stepOutputArtifactViewerFiles,
    stepArtifactsLoaded: stepArtifactsQuery.isFetched,
    stepArtifactsLoading: stepArtifactsQuery.isLoading || stepArtifactsQuery.isFetching,

    // Attempts
    attemptsByStepKey,
    attemptsLoading: attemptsQuery.isLoading,

    // Misc
    selectedStepStatus,
  }
}
