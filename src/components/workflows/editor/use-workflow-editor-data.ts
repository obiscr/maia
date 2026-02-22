"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useTopicStream } from "@/hooks/use-topic-stream"
import { toast } from "@/lib/client/toast"
import { tApiError } from "@/lib/shared/i18n/error"
import { makeStreamTopic } from "@/lib/shared/realtime/topics"
import { defaultWorkflowInputSpec, parseWorkflowInputSpec } from "@/lib/shared/maia/input-spec"
import { defaultWorkflowOutputsSpecV1, parseWorkflowOutputsSpec } from "@/lib/shared/maia/outputs-spec"
import { ApiError, apiFetchJson } from "@/lib/shared/http/api"
import { isRecord } from "@/lib/shared/lang/is-record"

import type { Step, Workflow } from "@/components/workflows/editor/workflow-editor-types"
import type {
  DepsInstallLog,
  SaveWorkflowPayload,
  UpdateWorkflowMetaPayload,
} from "@/components/workflows/editor/use-workflow-editor-api"

export function useWorkflowEditorData(params: {
  workflowId: string
  locale: string
  t: (key: string, vars?: Record<string, string | number>) => string
  onRequestInputSpecCloseConfirm?: () => void
  onRequestOutputsSpecCloseConfirm?: () => void
  api: {
    saveWorkflow: (body: SaveWorkflowPayload) => Promise<unknown>
    updateWorkflowMeta: (body: UpdateWorkflowMetaPayload) => Promise<unknown>
    deleteWorkflow: () => Promise<unknown>
    installDeps: () => Promise<{ ok?: boolean; operationId?: string }>
    fetchDepsInstallLogs: (limit?: number) => Promise<{ logs: DepsInstallLog[] }>
    createWorkflowVersion: (payload?: { description?: string | null }) => Promise<unknown>
  }
}) {
  const { workflowId, locale, t, api, onRequestInputSpecCloseConfirm, onRequestOutputsSpecCloseConfirm } = params
  const router = useRouter()

  // Structural sharing: keep the same `steps` array reference when the server payload's steps
  // are semantically identical. This prevents unnecessary graph rebuilds/flicker.
  const fingerprintSteps = React.useCallback((steps: Step[]) => {
    const normalized = (steps ?? [])
      .map((s) => ({
        stepKey: String(s.stepKey ?? ""),
        name: String(s.name ?? ""),
        description: s.description ?? null,
        scriptEsm: String(s.scriptEsm ?? ""),
        timeoutMs: typeof s.timeoutMs === "number" ? s.timeoutMs : null,
        deps: [...(s.deps ?? [])].map(String).sort(),
      }))
      .sort((a, b) => a.stepKey.localeCompare(b.stepKey))
    return JSON.stringify(normalized)
  }, [])

  const mergeWorkflowWithStableSteps = React.useCallback(
    (prev: Workflow | null, next: Workflow): Workflow => {
      if (!prev) return next
      try {
        const same = fingerprintSteps(prev.steps ?? []) === fingerprintSteps(next.steps ?? [])
        return same ? { ...next, steps: prev.steps } : next
      } catch {
        return next
      }
    },
    [fingerprintSteps],
  )

  const [wf, setWf] = React.useState<Workflow | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadErr, setLoadErr] = React.useState<unknown>(null)
  const [saving, setSaving] = React.useState(false)
  const [stepSavePending, setStepSavePending] = React.useState(false)

  const [depsJson, setDepsJson] = React.useState<string>("{}")
  const [depsDraftJson, setDepsDraftJson] = React.useState<string>("{}")
  const [depsDraftErr, setDepsDraftErr] = React.useState<string | null>(null)
  const [depsErr, setDepsErr] = React.useState<string | null>(null)
  const [depsInstallErr, setDepsInstallErr] = React.useState<unknown>(null)
  const [depsSavePending, setDepsSavePending] = React.useState(false)
  const [depsSheetOpen, setDepsSheetOpen] = React.useState(false)
  const [depsSheetTab, setDepsSheetTab] = React.useState<"deps" | "logs">("deps")
  const [depsInstallRealtimePending, setDepsInstallRealtimePending] = React.useState(false)
  const [depsInstallOperationId, setDepsInstallOperationId] = React.useState<string | null>(null)

  const depsInstallInFlight = depsInstallRealtimePending || wf?.depsStatus === "INSTALLING" || !!depsInstallOperationId

  const [envJson, setEnvJson] = React.useState<string>("{}")
  const [envDraftJson, setEnvDraftJson] = React.useState<string>("{}")
  const [envDraftErr, setEnvDraftErr] = React.useState<string | null>(null)
  const [envErr, setEnvErr] = React.useState<string | null>(null)
  const [envSavePending, setEnvSavePending] = React.useState(false)
  const [envSheetOpen, setEnvSheetOpen] = React.useState(false)

  const [inputSpecJson, setInputSpecJson] = React.useState<string>("")
  const [inputSpecDraftJson, setInputSpecDraftJson] = React.useState<string>("")
  const [inputSpecErr, setInputSpecErr] = React.useState<string | null>(null)
  const [inputSpecServerErr, setInputSpecServerErr] = React.useState<unknown>(null)
  const [inputSpecSheetOpen, setInputSpecSheetOpen] = React.useState(false)
  const [inputSpecAiPending, setInputSpecAiPending] = React.useState(false)
  const [inputSpecAiErr, setInputSpecAiErr] = React.useState<string | null>(null)

  const [outputsSpecJson, setOutputsSpecJson] = React.useState<string>("")
  const [outputsSpecDraftJson, setOutputsSpecDraftJson] = React.useState<string>("")
  const [outputsSpecErr, setOutputsSpecErr] = React.useState<string | null>(null)
  const [outputsSpecServerErr, setOutputsSpecServerErr] = React.useState<unknown>(null)
  const [outputsSpecSheetOpen, setOutputsSpecSheetOpen] = React.useState(false)
  const [outputsSpecAiPending, setOutputsSpecAiPending] = React.useState(false)
  const [outputsSpecAiErr, setOutputsSpecAiErr] = React.useState<string | null>(null)

  const [metaSheetOpen, setMetaSheetOpen] = React.useState(false)
  const [metaSavePending, setMetaSavePending] = React.useState(false)
  const [metaServerErr, setMetaServerErr] = React.useState<unknown>(null)
  const [metaNameDraft, setMetaNameDraft] = React.useState("")
  const [metaDescriptionDraft, setMetaDescriptionDraft] = React.useState("")

  const depsSheetContentRef = React.useRef<HTMLDivElement | null>(null)
  const envSheetContentRef = React.useRef<HTMLDivElement | null>(null)
  const inputSpecSheetContentRef = React.useRef<HTMLDivElement | null>(null)
  const outputsSpecSheetContentRef = React.useRef<HTMLDivElement | null>(null)
  const metaSheetContentRef = React.useRef<HTMLDivElement | null>(null)

  const metaDirty = React.useMemo(() => {
    if (!wf) return false
    const nameSaved = (wf.name ?? "").trim()
    const descSaved = (wf.description ?? "").trim()
    return (metaNameDraft ?? "").trim() !== nameSaved || (metaDescriptionDraft ?? "").trim() !== descSaved
  }, [wf, metaNameDraft, metaDescriptionDraft])

  async function load() {
    setLoading(true)
    try {
      const json = await apiFetchJson<{
        workflow: Workflow
      }>(`/api/workflows/${workflowId}`, {
        cache: "no-store",
      })
      setWf((prev) => mergeWorkflowWithStableSteps(prev, json.workflow))
      setLoadErr(null)
      setMetaNameDraft(json.workflow.name ?? "")
      setMetaDescriptionDraft(json.workflow.description ?? "")
      setMetaServerErr(null)
      setDepsJson(json.workflow.dependencies || "{}")
      setDepsDraftJson(json.workflow.dependencies || "{}")
      setDepsDraftErr(null)
      setEnvJson(json.workflow.envJson || "{}")
      setEnvDraftJson(json.workflow.envJson || "{}")
      setEnvDraftErr(null)
      const savedInputSpec = (json.workflow.inputSpec ?? "").trim()
      setInputSpecJson(savedInputSpec)
      setInputSpecDraftJson(savedInputSpec)
      setInputSpecErr(null)
      const savedOutputsSpec = (json.workflow.outputsSpec ?? "").trim()
      setOutputsSpecJson(savedOutputsSpec)
      setOutputsSpecDraftJson(savedOutputsSpec)
      setOutputsSpecErr(null)
      setLoading(false)
      return json.workflow
    } catch (e) {
      // Surface a page-level error state via the consumer (no toast by default).
      setLoadErr(e)
      setWf(null)
      setLoading(false)
      return null
    }
  }

  // Refresh workflow data without touching the global `loading` state (prevents dialog "re-mount" flash).
  async function refreshWorkflowSilently(opts?: { keepDraftIfDirty?: boolean }) {
    let json: { workflow: Workflow } | null = null
    try {
      json = await apiFetchJson<{ workflow: Workflow }>(`/api/workflows/${workflowId}`, { cache: "no-store" })
    } catch {
      return
    }
    setWf((prev) => mergeWorkflowWithStableSteps(prev, json.workflow))
    setMetaNameDraft((prev) => (metaSheetOpen && metaDirty ? prev : (json.workflow.name ?? "")))
    setMetaDescriptionDraft((prev) => (metaSheetOpen && metaDirty ? prev : (json.workflow.description ?? "")))
    setDepsJson(json.workflow.dependencies || "{}")
    const keepDraftIfDirty = opts?.keepDraftIfDirty ?? false
    setDepsDraftJson((prev) =>
      keepDraftIfDirty && prev !== (json.workflow.dependencies || "{}") ? prev : json.workflow.dependencies || "{}",
    )
    setDepsDraftErr(null)
    setEnvJson(json.workflow.envJson || "{}")
    setEnvDraftJson((prev) =>
      keepDraftIfDirty && prev !== (json.workflow.envJson || "{}") ? prev : json.workflow.envJson || "{}",
    )
    setEnvDraftErr(null)
    const savedInputSpec = (json.workflow.inputSpec ?? "").trim()
    setInputSpecJson(savedInputSpec)
    setInputSpecDraftJson((prev) => (keepDraftIfDirty && prev !== savedInputSpec ? prev : savedInputSpec))
    const savedOutputsSpec = (json.workflow.outputsSpec ?? "").trim()
    setOutputsSpecJson(savedOutputsSpec)
    setOutputsSpecDraftJson((prev) => (keepDraftIfDirty && prev !== savedOutputsSpec ? prev : savedOutputsSpec))
  }

  React.useEffect(() => {
    void load()
  }, [workflowId])

  // Keep depsStatus in sync during background install.
  // IMPORTANT: terminal state must never depend solely on a "tail" subscription (race-prone for fast installs).
  useTopicStream({
    topic: workflowId ? makeStreamTopic("workflowDeps", workflowId) : null,
    enabled: !!workflowId && depsInstallInFlight,
    extraParams: { from: "latest" },
    onMessage: (msg) => {
      if (msg.type !== "deps_status") return
      const d = msg.data
      const next = isRecord(d) ? String(d.depsStatus ?? "") : ""
      if (!next) return

      setWf((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          depsStatus: next,
          depsErrorCode: isRecord(d) ? ((d.depsErrorCode as string | null | undefined) ?? null) : prev.depsErrorCode,
          depsErrorMessage: isRecord(d)
            ? ((d.depsErrorMessage as string | null | undefined) ?? null)
            : prev.depsErrorMessage,
        }
      })

      if (next !== "INSTALLING") {
        setDepsInstallRealtimePending(false)
        setDepsInstallOperationId(null)
        // Ensure we fetch the authoritative state (depsUpdatedAt/meta) after completion.
        void refreshWorkflowSilently()
        if (next === "READY") toast.success(t("workflows.depsInstalled"))
        // NOTE: Do not toast on failure; the deps sheet footer should surface the error details.
      }
    },
  })

  // Track the *current* install operation (the most stable "this attempt" signal).
  useTopicStream({
    topic: depsInstallOperationId ? makeStreamTopic("operation", depsInstallOperationId) : null,
    enabled: !!depsInstallOperationId,
    persistCursor: false,
    // Do not tail here: operation completion can happen fast; we want replay to avoid missing terminal events.
    onMessage: (msg) => {
      if (!depsInstallOperationId) return
      if (msg.type !== "operation_completed") return
      // When the operation completes, always refresh from DB to converge.
      setDepsInstallRealtimePending(false)
      setDepsInstallOperationId(null)
      void refreshWorkflowSilently()
    },
  })

  // Input/outputs spec AI generation is now synchronous (no background agent runs).

  React.useEffect(() => {
    if (!metaSheetOpen) return
    // When opening, reset draft to current saved workflow fields (so sheet always starts clean).
    if (!wf) return
    if (metaDirty) return
    setMetaNameDraft(wf.name ?? "")
    setMetaDescriptionDraft(wf.description ?? "")
  }, [metaSheetOpen])

  const depsTable = React.useMemo((): { entries: { name: string; version: string }[]; parseError?: string } => {
    try {
      const obj = JSON.parse(depsJson || "{}")
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { entries: [] }

      const root = obj as Record<string, unknown>
      const out = new Map<string, string>()

      const ingest = (val: unknown) => {
        if (!val || typeof val !== "object" || Array.isArray(val)) return
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
          if (typeof v === "string") out.set(String(k), v)
        }
      }

      // Treat as package.json-like only when section values are objects; see WorkflowDepsManagerSheet.
      const isSectionObject = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v)
      const hasSections =
        isSectionObject(root.dependencies) ||
        isSectionObject(root.devDependencies) ||
        isSectionObject(root.optionalDependencies) ||
        isSectionObject(root.peerDependencies)
      if (hasSections) {
        if (isSectionObject(root.dependencies)) ingest(root.dependencies)
        if (isSectionObject(root.devDependencies)) ingest(root.devDependencies)
        if (isSectionObject(root.optionalDependencies)) ingest(root.optionalDependencies)
        if (isSectionObject(root.peerDependencies)) ingest(root.peerDependencies)
      } else ingest(root)

      const entries = [...out.entries()]
        .map(([name, version]) => ({ name, version }))
        .sort((a, b) => a.name.localeCompare(b.name))

      return { entries }
    } catch (e) {
      return { entries: [], parseError: e instanceof Error ? e.message : String(e) }
    }
  }, [depsJson])

  const envTable = React.useMemo((): { entries: { key: string; value: string }[]; parseError?: string } => {
    try {
      const obj = JSON.parse(envJson || "{}")
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { entries: [] }
      const entries = Object.entries(obj as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string")
        .map(([key, value]) => ({ key, value: String(value) }))
        .sort((a, b) => a.key.localeCompare(b.key))
      return { entries }
    } catch (e) {
      return { entries: [], parseError: e instanceof Error ? e.message : String(e) }
    }
  }, [envJson])

  const normalizeJsonLoose = React.useCallback((s: string) => {
    const trimmed = (s ?? "").trim()
    if (!trimmed) return ""
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2)
    } catch {
      return trimmed
    }
  }, [])

  const inputSpecDirty = React.useMemo(() => {
    return normalizeJsonLoose(inputSpecDraftJson) !== normalizeJsonLoose(inputSpecJson)
  }, [inputSpecDraftJson, inputSpecJson, normalizeJsonLoose])

  const inputSpecJsonOk = React.useMemo(() => {
    if (!inputSpecDraftJson.trim().length) return true
    try {
      JSON.parse(inputSpecDraftJson)
      return true
    } catch {
      return false
    }
  }, [inputSpecDraftJson])

  const outputsSpecDirty = React.useMemo(() => {
    return normalizeJsonLoose(outputsSpecDraftJson) !== normalizeJsonLoose(outputsSpecJson)
  }, [outputsSpecDraftJson, outputsSpecJson, normalizeJsonLoose])

  const outputsSpecJsonOk = React.useMemo(() => {
    const trimmed = outputsSpecDraftJson.trim()
    if (!trimmed.length) return true
    try {
      JSON.parse(trimmed)
      return !!parseWorkflowOutputsSpec(trimmed).spec
    } catch {
      return false
    }
  }, [outputsSpecDraftJson])

  async function save() {
    if (!wf) return false
    setSaving(true)
    setDepsErr(null)
    setEnvErr(null)
    setInputSpecErr(null)
    setInputSpecServerErr(null)
    setOutputsSpecErr(null)
    setOutputsSpecServerErr(null)
    try {
      try {
        JSON.parse(depsJson || "{}")
      } catch (e) {
        setDepsErr(e instanceof Error ? e.message : String(e))
        return false
      }
      try {
        JSON.parse(envJson || "{}")
      } catch (e) {
        setEnvErr(e instanceof Error ? e.message : String(e))
        return false
      }
      if (inputSpecDraftJson.trim().length) {
        try {
          JSON.parse(inputSpecDraftJson)
        } catch (e) {
          setInputSpecErr(e instanceof Error ? e.message : String(e))
          return false
        }
      }
      if (outputsSpecDraftJson.trim().length) {
        try {
          JSON.parse(outputsSpecDraftJson)
        } catch (e) {
          setOutputsSpecErr(e instanceof Error ? e.message : String(e))
          return false
        }
      }

      // Normalize/validate inputSpec:
      // - empty => null (unset)
      // - {} => treat as unset (common user expectation)
      // - otherwise must conform to WorkflowInputSpec schema (not just valid JSON)
      const inputSpecToSend = (() => {
        const trimmed = inputSpecDraftJson.trim()
        if (!trimmed.length) return null
        try {
          const j = JSON.parse(trimmed) as unknown
          if (
            j &&
            typeof j === "object" &&
            !Array.isArray(j) &&
            Object.keys(j as Record<string, unknown>).length === 0
          ) {
            return null
          }
        } catch {
          // JSON parse errors are handled above; keep fallback here defensive.
        }
        const parsed = parseWorkflowInputSpec(trimmed)
        if (!parsed.spec) {
          if (parsed.reservedKeys?.length) {
            setInputSpecErr(t("workflows.inputSpec.reservedKeys", { keys: parsed.reservedKeys.join(", ") }))
          } else {
            setInputSpecErr(t("workflows.inputSpec.invalidSpec"))
          }
          return "__INVALID__"
        }
        return JSON.stringify(parsed.spec, null, 2)
      })()
      if (inputSpecToSend === "__INVALID__") return false

      const outputsSpecToSend = (() => {
        const trimmed = outputsSpecDraftJson.trim()
        if (!trimmed.length) return null
        try {
          const j = JSON.parse(trimmed) as unknown
          if (
            j &&
            typeof j === "object" &&
            !Array.isArray(j) &&
            Object.keys(j as Record<string, unknown>).length === 0
          ) {
            return null
          }
        } catch {
          // JSON parse errors are handled above; keep fallback here defensive.
        }
        const parsed = parseWorkflowOutputsSpec(trimmed)
        if (!parsed.spec) {
          setOutputsSpecErr(t("workflows.outputsSpec.invalidSpec"))
          return "__INVALID__"
        }
        return JSON.stringify(parsed.spec, null, 2)
      })()
      if (outputsSpecToSend === "__INVALID__") return false

      await api.saveWorkflow({
        name: wf.name,
        description: wf.description ?? undefined,
        dependencies: depsJson || "{}",
        envJson: envJson || "{}",
        inputSpec: inputSpecToSend,
        outputsSpec: outputsSpecToSend,
        steps: wf.steps.map((s) => ({
          stepKey: s.stepKey,
          name: s.name,
          description: s.description ?? undefined,
          scriptEsm: s.scriptEsm,
          timeoutMs: s.timeoutMs,
          deps: s.deps,
        })),
      })
      await refreshWorkflowSilently()
      toast.success(t("common.saved"))
      return true
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.code === "INVALID_INPUT_SPEC" ||
          e.code === "INVALID_INPUT_SPEC_SCHEMA" ||
          e.code === "INVALID_INPUT_SPEC_RESERVED_FIELDS")
      ) {
        setInputSpecServerErr(e)
        setInputSpecSheetOpen(true)
        return false
      }
      if (e instanceof ApiError && e.code === "INVALID_OUTPUTS_SPEC") {
        setOutputsSpecServerErr(e)
        setOutputsSpecErr(tApiError({ t, err: e, fallbackKey: "errors.SAVE_FAILED" }))
        setOutputsSpecSheetOpen(true)
        return false
      }
      toast.error(tApiError({ t, err: e, fallbackKey: "errors.SAVE_FAILED" }))
      return false
    } finally {
      setSaving(false)
    }
  }

  async function deleteWorkflow(): Promise<boolean> {
    if (!wf) return false
    try {
      await api.deleteWorkflow()
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.deleteActionFailed" }))
      return false
    }
    toast.success(t("workflows.deletedToast"))
    router.replace("/workflows")
    return true
  }

  async function installDeps() {
    try {
      setDepsInstallErr(null)
      // Start listening immediately; backend completes async.
      setDepsInstallRealtimePending(true)
      // Optimistic UI: flip to INSTALLING immediately (SSE/refresh will reconcile final status).
      setWf((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          depsStatus: "INSTALLING",
          depsErrorCode: null,
          depsErrorMessage: null,
          depsErrorMetaJson: null,
          depsErrorAt: null,
        }
      })
      const res = await api.installDeps()
      const opId = res?.operationId ? String(res.operationId) : ""
      if (opId) setDepsInstallOperationId(opId)
    } catch (e) {
      setDepsInstallErr(e)
      setDepsInstallRealtimePending(false)
      setDepsInstallOperationId(null)
      await refreshWorkflowSilently()
      return
    }
    // Do NOT refresh immediately here (race-prone -> can overwrite optimistic INSTALLING with stale IDLE).
  }

  async function saveDepsDraft(opts?: { silentToast?: boolean }) {
    if (!wf) return
    if (depsSavePending) return
    setDepsSavePending(true)
    try {
      await api.saveWorkflow({
        name: wf.name,
        description: wf.description ?? undefined,
        dependencies: depsDraftJson || "{}",
        envJson: envJson || "{}",
        // NOTE: omit inputSpec to avoid overwriting; API keeps existing when field is absent.
        steps: wf.steps.map((s) => ({
          stepKey: s.stepKey,
          name: s.name,
          description: s.description ?? undefined,
          scriptEsm: s.scriptEsm,
          timeoutMs: s.timeoutMs,
          deps: s.deps,
        })),
      })
      await refreshWorkflowSilently()
      if (!opts?.silentToast) toast.success(t("common.saved"))
    } finally {
      setDepsSavePending(false)
    }
  }

  async function saveEnvDraft() {
    if (!wf) return
    if (envSavePending) return
    setEnvSavePending(true)
    try {
      await api.saveWorkflow({
        name: wf.name,
        description: wf.description ?? undefined,
        dependencies: depsJson || "{}",
        envJson: envDraftJson || "{}",
        // NOTE: omit inputSpec to avoid overwriting; API keeps existing when field is absent.
        steps: wf.steps.map((s) => ({
          stepKey: s.stepKey,
          name: s.name,
          description: s.description ?? undefined,
          scriptEsm: s.scriptEsm,
          timeoutMs: s.timeoutMs,
          deps: s.deps,
        })),
      })
      await refreshWorkflowSilently()
      toast.success(t("common.saved"))
    } finally {
      setEnvSavePending(false)
    }
  }

  async function saveMetaDraft() {
    if (!wf) return
    if (metaSavePending) return
    setMetaSavePending(true)
    setMetaServerErr(null)
    try {
      const nameTrimmed = (metaNameDraft ?? "").trim()
      if (!nameTrimmed.length) return
      const descTrimmed = (metaDescriptionDraft ?? "").trim()
      await api.updateWorkflowMeta({
        name: nameTrimmed,
        description: descTrimmed.length ? descTrimmed : null,
      })
      await refreshWorkflowSilently()
      toast.success(t("common.saved"))
    } catch (e) {
      setMetaServerErr(e)
      toast.error(tApiError({ t, err: e, fallbackKey: "errors.SAVE_FAILED" }))
    } finally {
      setMetaSavePending(false)
    }
  }

  function resetMetaDraft() {
    if (!wf) return
    setMetaNameDraft(wf.name ?? "")
    setMetaDescriptionDraft(wf.description ?? "")
    setMetaServerErr(null)
  }

  async function saveStepsDraft(
    nextSteps: Step[],
    opts?: { silentToast?: boolean },
  ): Promise<{ ok: boolean; didSave: boolean }> {
    if (!wf) return { ok: false, didSave: false }
    // If a save is already in-flight, treat as "ok but skipped" so autosave doesn't show a false error.
    if (stepSavePending) return { ok: true, didSave: false }
    setStepSavePending(true)
    try {
      await api.saveWorkflow({
        name: wf.name,
        description: wf.description ?? undefined,
        dependencies: depsJson || "{}",
        envJson: envJson || "{}",
        // NOTE: omit inputSpec to avoid overwriting; API keeps existing when field is absent.
        steps: nextSteps.map((s) => ({
          stepKey: s.stepKey,
          name: s.name,
          description: s.description ?? undefined,
          scriptEsm: s.scriptEsm,
          timeoutMs: s.timeoutMs,
          deps: s.deps,
        })),
      })
      return { ok: true, didSave: true }
    } catch (e) {
      if (!opts?.silentToast) toast.error(tApiError({ t, err: e, fallbackKey: "errors.SAVE_FAILED" }))
      return { ok: false, didSave: false }
    } finally {
      setStepSavePending(false)
    }
  }

  async function saveAndCloseInputSpecSheet(): Promise<boolean> {
    const ok = await save()
    if (ok) setInputSpecSheetOpen(false)
    return ok
  }

  async function saveAndCloseOutputsSpecSheet(): Promise<boolean> {
    const ok = await save()
    if (ok) setOutputsSpecSheetOpen(false)
    return ok
  }

  async function generateInputSpecWithAi() {
    if (inputSpecAiPending) return
    setInputSpecAiErr(null)
    setInputSpecAiPending(true)

    try {
      toast.info(t("workflows.orchestrator.createInputSpecQueued"))
      const res = await apiFetchJson<{ inputSpec?: string }>(
        `/api/workflows/${encodeURIComponent(workflowId)}/generate-input-spec`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locale,
            instructions:
              "Infer params from how scripts read input.initialInput. Keep required minimal. Provide 1-3 examples (most common first).",
          }),
        },
      )
      const spec = typeof res?.inputSpec === "string" ? res.inputSpec : ""
      if (spec) {
        setInputSpecDraftJson(spec)
        setInputSpecErr(null)
      }
      await refreshWorkflowSilently({ keepDraftIfDirty: true })
    } catch (e) {
      setInputSpecAiErr(
        e instanceof ApiError
          ? tApiError({ t, err: e, fallbackKey: "workflows.orchestrator.errors.failed" })
          : e instanceof Error
            ? e.message
            : String(e),
      )
    } finally {
      setInputSpecAiPending(false)
    }
  }

  async function generateOutputsSpecWithAi() {
    if (outputsSpecAiPending) return
    setOutputsSpecAiErr(null)
    setOutputsSpecAiPending(true)

    try {
      toast.info(t("workflows.orchestrator.createOutputsSpecQueued"))
      const res = await apiFetchJson<{ outputsSpec?: string }>(
        `/api/workflows/${encodeURIComponent(workflowId)}/generate-outputs-spec`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locale,
            instructions: "Infer stable named outputs from step outputs. Prefer 1-5 outputs.",
          }),
        },
      )
      const spec = typeof res?.outputsSpec === "string" ? res.outputsSpec : ""
      if (spec) {
        setOutputsSpecDraftJson(spec)
        setOutputsSpecErr(null)
      }
      await refreshWorkflowSilently({ keepDraftIfDirty: true })
    } catch (e) {
      setOutputsSpecAiErr(
        e instanceof ApiError
          ? tApiError({ t, err: e, fallbackKey: "workflows.orchestrator.errors.failed" })
          : e instanceof Error
            ? e.message
            : String(e),
      )
    } finally {
      setOutputsSpecAiPending(false)
    }
  }

  function insertDefaultInputSpec() {
    const next = JSON.stringify(defaultWorkflowInputSpec(), null, 2)
    setInputSpecDraftJson(next)
    setInputSpecErr(null)
  }

  function insertDefaultOutputsSpec() {
    const next = JSON.stringify(defaultWorkflowOutputsSpecV1(), null, 2)
    setOutputsSpecDraftJson(next)
    setOutputsSpecErr(null)
  }

  function resetInputSpecDraft() {
    setInputSpecDraftJson(inputSpecJson)
    setInputSpecErr(null)
    setInputSpecAiErr(null)
  }

  function resetOutputsSpecDraft() {
    setOutputsSpecDraftJson(outputsSpecJson)
    setOutputsSpecErr(null)
    setOutputsSpecAiErr(null)
  }

  function onInputSpecDraftJsonChange(next: string) {
    setInputSpecDraftJson(next)
    if (!next.trim().length) {
      setInputSpecErr(null)
      return
    }
    try {
      JSON.parse(next)
      setInputSpecErr(null)
    } catch (e) {
      setInputSpecErr(e instanceof Error ? e.message : String(e))
    }
  }

  function onOutputsSpecDraftJsonChange(next: string) {
    setOutputsSpecDraftJson(next)
    if (!next.trim().length) {
      setOutputsSpecErr(null)
      return
    }
    try {
      JSON.parse(next)
      const parsed = parseWorkflowOutputsSpec(next)
      setOutputsSpecErr(parsed.spec ? null : t("workflows.outputsSpec.invalidSpec"))
    } catch (e) {
      setOutputsSpecErr(e instanceof Error ? e.message : String(e))
    }
  }

  function onInputSpecSheetOpenChange(o: boolean) {
    if (!o && inputSpecDirty) {
      onRequestInputSpecCloseConfirm?.()
      return
    }
    setInputSpecSheetOpen(o)
  }

  function onOutputsSpecSheetOpenChange(o: boolean) {
    if (!o && outputsSpecDirty) {
      onRequestOutputsSpecCloseConfirm?.()
      return
    }
    setOutputsSpecSheetOpen(o)
  }

  function discardAndCloseInputSpec() {
    setInputSpecDraftJson(inputSpecJson)
    setInputSpecErr(null)
    setInputSpecAiErr(null)
    setInputSpecSheetOpen(false)
  }

  function discardAndCloseOutputsSpec() {
    setOutputsSpecDraftJson(outputsSpecJson)
    setOutputsSpecErr(null)
    setOutputsSpecAiErr(null)
    setOutputsSpecServerErr(null)
    setOutputsSpecSheetOpen(false)
  }

  return {
    wf,
    setWf,
    loading,
    loadErr,
    saving,

    metaSheetOpen,
    setMetaSheetOpen,
    metaSheetContentRef,
    metaSavePending,
    metaServerErr,
    metaNameDraft,
    setMetaNameDraft,
    metaDescriptionDraft,
    setMetaDescriptionDraft,
    saveMetaDraft,
    resetMetaDraft,

    depsJson,
    setDepsJson,
    depsDraftJson,
    setDepsDraftJson,
    depsDraftErr,
    setDepsDraftErr,
    depsErr,
    setDepsErr,
    depsInstallErr,
    setDepsInstallErr,
    depsSavePending,
    depsSheetOpen,
    setDepsSheetOpen,
    depsSheetTab,
    setDepsSheetTab,
    depsSheetContentRef,
    depsTable,
    saveDepsDraft,
    installDeps,
    depsInstallInFlight,

    envJson,
    setEnvJson,
    envDraftJson,
    setEnvDraftJson,
    envDraftErr,
    setEnvDraftErr,
    envErr,
    setEnvErr,
    envSavePending,
    envSheetOpen,
    setEnvSheetOpen,
    envSheetContentRef,
    envTable,
    saveEnvDraft,

    stepSavePending,
    saveStepsDraft,

    inputSpecJson,
    inputSpecDraftJson,
    inputSpecErr,
    inputSpecServerErr,
    inputSpecSheetOpen,
    inputSpecAiPending,
    inputSpecAiErr,
    inputSpecSheetContentRef,
    inputSpecDirty,
    inputSpecJsonOk,
    onInputSpecDraftJsonChange,
    onInputSpecSheetOpenChange,
    discardAndCloseInputSpec,
    saveAndCloseInputSpecSheet,
    generateInputSpecWithAi,
    insertDefaultInputSpec,
    resetInputSpecDraft,

    outputsSpecJson,
    outputsSpecDraftJson,
    outputsSpecErr,
    outputsSpecServerErr,
    outputsSpecSheetOpen,
    outputsSpecAiPending,
    outputsSpecAiErr,
    outputsSpecSheetContentRef,
    outputsSpecDirty,
    outputsSpecJsonOk,
    onOutputsSpecDraftJsonChange,
    onOutputsSpecSheetOpenChange,
    discardAndCloseOutputsSpec,
    saveAndCloseOutputsSpecSheet,
    generateOutputsSpecWithAi,
    insertDefaultOutputsSpec,
    resetOutputsSpecDraft,

    deleteWorkflow,

    load,
    refreshWorkflowSilently,
    save,

    fetchDepsInstallLogs: api.fetchDepsInstallLogs,
  }
}
