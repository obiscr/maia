"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { toast } from "@/lib/client/toast"
import { ApiError, apiFetchJson } from "@/lib/shared/http/api"
import { tError } from "@/lib/shared/i18n/error"
import { isRecord } from "@/lib/shared/lang/is-record"
import { useTopicStream } from "@/hooks/use-topic-stream"
import { makeStreamTopic } from "@/lib/shared/realtime/topics"
import { MAIA_MONACO_THEME_DARK, MAIA_MONACO_THEME_LIGHT } from "@/lib/client/monaco"

function readRecordStringField(data: unknown, key: string): string | null {
  if (!isRecord(data)) return null
  const v = data[key]
  return typeof v === "string" ? String(v) : null
}

export type UiMessage = { role: "user" | "assistant"; content: string }
export type ProposalState = { ok?: boolean; draft?: unknown; warnings?: string[] } | null
export type PlanState = { ok?: boolean; title?: string | null; steps?: string[] } | null
export type AgentUiSignal = {
  ok?: boolean
  phase: "plan" | "draft" | "validate" | "inputSpec" | "outputsSpec"
  state: "start" | "end"
  stepIndex?: number
  stepTitle?: string
}
export type AgentStageStatus = "todo" | "in_progress" | "done" | "failed"
export type AgentStageState = {
  plan: AgentStageStatus
  draft: AgentStageStatus
  validate: AgentStageStatus
  inputSpec: AgentStageStatus
  outputsSpec: AgentStageStatus
}
export type AgentProgressState = {
  phase: "idle" | "planning" | "planned" | "drafting" | "validating" | "inputSpec" | "outputsSpec" | "done"
  doneCount: number
  activeIdx: number | null
}

export type WorkflowStep = {
  stepKey: string
  name: string
  description?: string | null
  scriptEsm: string
  timeoutMs?: number
  deps: string[]
}

export type WorkflowForPanel = {
  id: string
  name: string
  description: string | null
  dependencies?: string
  inputSpec?: string
  steps: WorkflowStep[]
}

export type AgentRunErrorState = {
  errorCode: string | null
  errorMessage: string | null
  errorMetaJson: string | null
} | null

function readDraftSteps(p: ProposalState): WorkflowStep[] | null {
  const draft = p?.draft
  if (!isRecord(draft)) return null
  const steps = draft.steps
  if (!Array.isArray(steps)) return null
  return steps as WorkflowStep[]
}

function readDraftObject(p: ProposalState): Record<string, unknown> | null {
  return isRecord(p?.draft) ? (p?.draft as Record<string, unknown>) : null
}

export function useWorkflowAgentSession(params: {
  agentRunId?: string | null
  workflowId?: string
  locale: string
  t: (k: string, vars?: Record<string, string | number>) => string
  /**
   * Optional prompt to auto-send exactly once (useful for modal/dialog flows that should not rely on URL params).
   * When provided, it takes precedence over `?prompt=` in the URL and will NOT modify the router URL.
   */
  initialPrompt?: string | null
}) {
  const { agentRunId, workflowId, locale, t, initialPrompt } = params

  const router = useRouter()
  const searchParams = useSearchParams()
  const promptFromUrl = searchParams.get("prompt")
  const [promptFromSessionStorage, setPromptFromSessionStorage] = React.useState<string | null>(null)

  // Optional fallback: allow page-to-page navigation to pass a large prompt without putting it in the URL.
  // This avoids URL-length limits (e.g. proxies / Node header limits) especially for percent-encoded UTF-8 text.
  React.useEffect(() => {
    // If `initialPrompt` is provided, do not read storage (dialog/modal flows).
    if (initialPrompt) return
    try {
      const key = "maia.workflows.orchestrator.initialPrompt"
      const v = sessionStorage.getItem(key)
      if (!v) return
      sessionStorage.removeItem(key)
      setPromptFromSessionStorage(v)
    } catch {
      // ignore (storage blocked/unavailable)
    }
  }, [initialPrompt])

  const [messages, setMessages] = React.useState<UiMessage[]>([])
  const [proposal, setProposal] = React.useState<ProposalState>(null)
  const [plan, setPlan] = React.useState<PlanState>(null)
  const [progress, setProgress] = React.useState<AgentProgressState>({ phase: "idle", doneCount: 0, activeIdx: null })
  const [stages, setStages] = React.useState<AgentStageState>({
    plan: "todo",
    draft: "todo",
    validate: "todo",
    inputSpec: "todo",
    outputsSpec: "todo",
  })
  const [hasAssistantOutput, setHasAssistantOutput] = React.useState(false)
  const [input, setInput] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const [workflow, setWorkflow] = React.useState<WorkflowForPanel | null>(null)
  const [workflowLoading, setWorkflowLoading] = React.useState(false)
  const [selectedStepKey, setSelectedStepKey] = React.useState<string | null>(null)
  const [stepSheetOpen, setStepSheetOpen] = React.useState(false)
  const [graphOverrideSteps, setGraphOverrideSteps] = React.useState<WorkflowStep[] | null>(null)
  const [dirty, setDirty] = React.useState(false)
  const [agentRunLastEventId, setAgentRunLastEventId] = React.useState<number | null>(null)
  const [agentRunError, setAgentRunError] = React.useState<AgentRunErrorState>(null)

  const listRef = React.useRef<HTMLDivElement | null>(null)
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)

  const streamExtraParams = React.useMemo(() => {
    return agentRunLastEventId ? { fromId: String(agentRunLastEventId) } : undefined
  }, [agentRunLastEventId])

  const [isDarkTheme, setIsDarkTheme] = React.useState(false)
  React.useEffect(() => {
    const el = document.documentElement
    const update = () => setIsDarkTheme(el.classList.contains("dark"))
    update()
    const observer = new MutationObserver(() => update())
    observer.observe(el, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  const monacoTheme = isDarkTheme ? MAIA_MONACO_THEME_DARK : MAIA_MONACO_THEME_LIGHT

  // Load workflow snapshot for panel editing.
  React.useEffect(() => {
    if (!workflowId) return
    let canceled = false
    setWorkflowLoading(true)
    apiFetchJson<{ workflow?: WorkflowForPanel | null }>(`/api/workflows/${workflowId}`, { cache: "no-store" })
      .then((j) => {
        if (canceled) return
        const wf = (j?.workflow ?? null) as WorkflowForPanel | null
        setWorkflow(wf)
        setSelectedStepKey((prev) => prev ?? wf?.steps?.[0]?.stepKey ?? null)
        setDirty(false)
      })
      .catch(() => {
        // ignore; the UI shows a fallback state
      })
      .finally(() => {
        if (canceled) return
        setWorkflowLoading(false)
      })
    return () => {
      canceled = true
    }
  }, [workflowId])

  const reloadTmrRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    return () => {
      if (reloadTmrRef.current) window.clearTimeout(reloadTmrRef.current)
    }
  }, [])

  const loadAgentRun = React.useCallback(async () => {
    if (!agentRunId) return
    const j = await apiFetchJson<{
      agentRun?: {
        workflowId?: string | null
        status?: string
        lastEventId?: number | null
        snapshotJson?: string
        errorCode?: string | null
        errorMessage?: string | null
        errorMetaJson?: string | null
      }
    }>(`/api/agent-runs/${encodeURIComponent(agentRunId)}`, { cache: "no-store" })
    const ar = (j?.agentRun ?? null) as Record<string, unknown> | null
    const st = typeof ar?.status === "string" ? String(ar.status) : null
    setPending(st === "QUEUED" || st === "RUNNING")
    const last =
      typeof ar?.lastEventId === "number" && Number.isFinite(ar.lastEventId) ? Math.floor(ar.lastEventId) : null
    setAgentRunLastEventId(last)

    const errCode = typeof ar?.errorCode === "string" ? String(ar.errorCode) : null
    const errMsg = typeof ar?.errorMessage === "string" ? String(ar.errorMessage) : null
    const errMeta = typeof ar?.errorMetaJson === "string" ? String(ar.errorMetaJson) : null
    setAgentRunError(
      errCode || errMsg || errMeta ? { errorCode: errCode, errorMessage: errMsg, errorMetaJson: errMeta } : null,
    )

    const snapStr = typeof ar?.snapshotJson === "string" ? String(ar.snapshotJson) : "{}"
    let snap: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(snapStr || "{}")
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) snap = parsed as Record<string, unknown>
    } catch {
      snap = {}
    }

    const msgs = Array.isArray(snap.messages) ? (snap.messages as UiMessage[]) : []
    setMessages(msgs)
    setHasAssistantOutput(Boolean(snap.hasAssistantOutput))
    setPlan((snap.plan ?? null) as PlanState)
    setProposal((snap.proposal ?? null) as ProposalState)
    const draftSteps = Array.isArray(snap.draftSteps) ? (snap.draftSteps as WorkflowStep[]) : null
    if (draftSteps && draftSteps.length) setGraphOverrideSteps(draftSteps)

    const hasPlan = !!(snap.plan && typeof snap.plan === "object")
    const hasDraft = Array.isArray(draftSteps) && draftSteps.length > 0
    const proposalObj =
      snap.proposal && typeof snap.proposal === "object" ? (snap.proposal as Record<string, unknown>) : null
    const hasProposal = !!proposalObj && "draft" in proposalObj && !!proposalObj["draft"]
    setProgress({
      phase: hasProposal ? "done" : hasDraft ? "drafting" : hasPlan ? "planning" : "idle",
      doneCount: hasDraft ? draftSteps!.length : 0,
      activeIdx: null,
    })
    setStages({
      plan: hasPlan ? "done" : "todo",
      draft: hasDraft ? (hasProposal ? "done" : "in_progress") : "todo",
      validate: hasProposal ? "done" : "todo",
      inputSpec: "todo",
      outputsSpec: "todo",
    })
  }, [agentRunId])

  React.useEffect(() => {
    if (!agentRunId) return
    let canceled = false
    void (async () => {
      try {
        await loadAgentRun()
      } catch {
        if (canceled) return
      }
    })()
    return () => {
      canceled = true
    }
  }, [agentRunId, loadAgentRun])

  useTopicStream({
    topic: agentRunId ? makeStreamTopic("agentRun", agentRunId) : null,
    enabled: !!agentRunId,
    cursorKey: agentRunId ? `maia.agentRunCursor:${agentRunId}` : undefined,
    persistCursor: true,
    extraParams: streamExtraParams,
    onMessage: () => {
      if (!agentRunId) return
      if (reloadTmrRef.current) window.clearTimeout(reloadTmrRef.current)
      reloadTmrRef.current = window.setTimeout(() => void loadAgentRun().catch(() => {}), 200)
    },
  })

  React.useEffect(() => {
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages])

  // Also scroll when progress/proposal changes; otherwise CTA blocks rendered near the bottom
  // (e.g. "Save / Create workflow") can appear below the fold and look "missing".
  React.useEffect(() => {
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [proposal, progress.phase, progress.doneCount])

  const stepsForGraph = React.useMemo((): WorkflowStep[] => {
    if (Array.isArray(graphOverrideSteps)) return graphOverrideSteps
    const draftSteps = readDraftSteps(proposal)
    if (Array.isArray(draftSteps)) return draftSteps
    return workflow?.steps ?? []
  }, [graphOverrideSteps, proposal, workflow])

  const selectedStep = React.useMemo(() => {
    if (!selectedStepKey) return null
    return stepsForGraph.find((s) => s.stepKey === selectedStepKey) ?? null
  }, [stepsForGraph, selectedStepKey])

  const send = React.useCallback(
    async (overrideText?: string) => {
      const text = String(overrideText ?? input).trim()
      if (!text || pending) return

      // Create an AgentRun and navigate to its canonical URL.
      try {
        const queuedToastId = toast.loading(t("workflows.orchestrator.createWorkflowQueued"))
        const nextMsgs: UiMessage[] = [...messages, { role: "user", content: text }]
        const res = await apiFetchJson<{ agentRunId?: string }>("/api/agent-runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "WORKFLOW_ORCHESTRATE",
            workflowId,
            locale,
            messages: nextMsgs
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((m) => ({ role: m.role, content: m.content })),
          }),
        })
        toast.dismiss(queuedToastId)
        const id = typeof res?.agentRunId === "string" ? String(res.agentRunId) : ""
        if (!id) return
        router.push(`/agent/${encodeURIComponent(id)}`)
      } catch (e) {
        toast.error(
          e instanceof ApiError
            ? tError({ t, code: e.code, fallbackKey: "common.error" })
            : e instanceof Error
              ? e.message
              : String(e),
        )
      }
      return
      /*
      setInput("")
      setPending(true)
      setProposal(null)
      setPlan(null)
      setProgress({ phase: "idle", doneCount: 0, activeIdx: null })
      setStages({ plan: "todo", draft: "todo", validate: "todo", inputSpec: "todo", outputsSpec: "todo" })
      setHasAssistantOutput(false)
      setGraphOverrideSteps(null)
      // Some models emit draft_step before update_plan / before drafting signals; buffer until we're ready.
      const bufferedDraftSteps: WorkflowStep[] = []
      let hasPlan = false
      let draftingStarted = false
      let doneCount = 0
      let planLen = 0
      // Tracks whether we started a follow-up CreateInputSchemaAgent request in this send.
      // Kept for future UX (e.g. preventing premature "done" UI), but currently not used elsewhere.
      let didStartInputSpec = false
      let phaseLocal: AgentProgressState["phase"] = "idle"

      const applyDraftStep = (step: WorkflowStep) => {
        setDirty(true)
        setGraphOverrideSteps((prev) => {
          const next = Array.isArray(prev) ? [...prev] : []
          const idx = next.findIndex((s) => s.stepKey === step.stepKey)
          if (idx >= 0) next[idx] = { ...next[idx], ...step }
          else next.push(step)
          return next
        })
        setSelectedStepKey((prev) => prev ?? step.stepKey)
      }

      const nextMsgs: UiMessage[] = [...messages, { role: "user", content: text }, { role: "assistant", content: "" }]
      setMessages(nextMsgs)

      const queuedToastId = toast.loading(t("workflows.orchestrator.createWorkflowQueued"))
      let dismissedQueuedToast = false

      try {
        const res = await fetch("/api/agent/workflows/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflowId,
            locale,
            messages: nextMsgs
              .slice(0, -1)
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((m) => ({ role: m.role, content: m.content })),
          }),
        })

        if (!res.ok || !res.body) {
          const j: unknown = await res.json().catch(() => ({}))
          const code = isRecord(j) && typeof j.code === "string" ? String(j.code) : "HTTP_ERROR"
          throw new ApiError({
            status: res.status,
            code,
            meta: isRecord(j) && isRecord(j.meta) ? (j.meta as Record<string, unknown>) : undefined,
          })
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let carry = ""
        let didReceiveTerminalEvent = false
        let didReceiveErrorEvent = false
        let shouldStopAfterBatch = false

        while (true) {
          const { value, done } = await reader.read()
          if (done) break

          // First bytes received → backend accepted the request and started streaming.
          if (!dismissedQueuedToast) {
            toast.dismiss(queuedToastId)
            dismissedQueuedToast = true
          }

          carry += decoder.decode(value, { stream: true })
          const parsed = parseSseChunk(carry)
          carry = parsed.rest

          shouldStopAfterBatch = false
          for (const ev of parsed.events) {
            if (ev.event === "delta") {
              const delta = readRecordStringField(ev.data, "delta") ?? ""
              if (!delta) continue
              setHasAssistantOutput(true)
              setMessages((prev) => {
                const copy = [...prev]
                const lastIdx = copy.length - 1
                if (lastIdx >= 0 && copy[lastIdx]?.role === "assistant") {
                  copy[lastIdx] = { ...copy[lastIdx], content: (copy[lastIdx].content ?? "") + delta }
                }
                return copy
              })
            } else if (ev.event === "plan") {
              setPlan(ev.data as PlanState)
              // Record that a plan exists, but do NOT advance UI phase here.
              // UI phase transitions are driven by explicit ui_signal(plan, end).
              const steps = isRecord(ev.data) && Array.isArray(ev.data.steps) ? ev.data.steps : null
              hasPlan = Array.isArray(steps) && steps.length > 0
              planLen = hasPlan && steps ? steps.length : 0
              if (hasPlan && bufferedDraftSteps.length) {
                // Only flush when drafting has started; otherwise keep buffer to preserve correct UI timing.
                if (draftingStarted) {
                  for (const step of bufferedDraftSteps.splice(0, bufferedDraftSteps.length)) {
                    applyDraftStep(step)
                    doneCount += 1
                    setProgress((prev) => ({
                      phase: "drafting",
                      doneCount: doneCount,
                      activeIdx: doneCount < planLen ? doneCount : null,
                    }))
                  }
                }
              }
            } else if (ev.event === "proposal") {
              setProposal(ev.data as ProposalState)
              // Only clear streaming override if we received a valid draft (source of truth becomes proposal.draft).
              if (isRecord(ev.data) && ev.data.draft) {
                setGraphOverrideSteps(null)
                setDirty(true)
                // Proposal with a draft is terminal for this stream; mark done and stop reading.
                doneCount = Math.max(doneCount, planLen)
                setProgress({ phase: "done", activeIdx: null, doneCount })
                // If we reached a validated draft, treat validation as complete even if we miss ui(validate,end).
                setStages((prev) => ({
                  ...prev,
                  plan: prev.plan === "todo" ? "done" : prev.plan,
                  draft: prev.draft === "todo" ? "done" : prev.draft === "in_progress" ? "done" : prev.draft,
                  validate: prev.validate === "in_progress" ? "done" : prev.validate,
                }))
                didReceiveTerminalEvent = true
                shouldStopAfterBatch = true
              }
            } else if (ev.event === "ui") {
              const sig = (ev.data ?? {}) as AgentUiSignal
              if (sig.phase === "plan" && sig.state === "start") {
                if (process.env.NODE_ENV !== "production") console.debug("[agent-ui]", "plan:start")
                // Do not allow late plan signals to regress state after drafting has begun.
                if (
                  phaseLocal === "drafting" ||
                  phaseLocal === "validating" ||
                  phaseLocal === "inputSpec" ||
                  draftingStarted
                ) {
                  setStages((prev) => ({
                    ...prev,
                    plan: prev.plan === "todo" ? "done" : prev.plan === "in_progress" ? "done" : prev.plan,
                  }))
                } else {
                  phaseLocal = "planning"
                  setProgress({ phase: "planning", doneCount: 0, activeIdx: null })
                  setStages((prev) => ({ ...prev, plan: "in_progress" }))
                }
              }
              if (sig.phase === "plan" && sig.state === "end") {
                if (process.env.NODE_ENV !== "production") console.debug("[agent-ui]", "plan:end")
                if (
                  phaseLocal === "drafting" ||
                  phaseLocal === "validating" ||
                  phaseLocal === "inputSpec" ||
                  draftingStarted
                ) {
                  setStages((prev) => ({ ...prev, plan: prev.plan === "todo" ? "done" : "done" }))
                } else {
                  phaseLocal = "planned"
                  setProgress((prev) => ({ ...prev, phase: "planned" }))
                  setStages((prev) => ({ ...prev, plan: "done" }))
                }
              }
              if (sig.phase === "draft" && sig.state === "start") {
                if (process.env.NODE_ENV !== "production") console.debug("[agent-ui]", "draft:start")
                draftingStarted = true
                doneCount = 0
                phaseLocal = "drafting"
                setProgress((prev) => ({
                  phase: "drafting",
                  doneCount: 0,
                  activeIdx: 0,
                }))
                setStages((prev) => ({
                  ...prev,
                  // Drafting implies planning is complete (even if plan ui events are missing).
                  plan: prev.plan === "failed" ? "failed" : "done",
                  draft: "in_progress",
                }))
                // If we already have plan + buffered steps, start applying them now (keeps ordering).
                if (hasPlan && bufferedDraftSteps.length) {
                  for (const step of bufferedDraftSteps.splice(0, bufferedDraftSteps.length)) {
                    applyDraftStep(step)
                    doneCount += 1
                    setProgress({ phase: "drafting", doneCount, activeIdx: doneCount < planLen ? doneCount : null })
                  }
                }
              }
              if (sig.phase === "draft" && sig.state === "end") {
                if (process.env.NODE_ENV !== "production") console.debug("[agent-ui]", "draft:end")
                // The model claims drafting is complete. In practice it may still need time to assemble and validate
                // the final payload. Show an explicit "validating" state to avoid the "all steps done but pending" confusion.
                phaseLocal = "validating"
                setProgress({ phase: "validating", doneCount: Math.max(doneCount, planLen), activeIdx: null })
                setStages((prev) => ({ ...prev, draft: "done", validate: "in_progress" }))
              }
              if (sig.phase === "validate" && sig.state === "start") {
                if (process.env.NODE_ENV !== "production") console.debug("[agent-ui]", "validate:start")
                // Steps may already be fully drafted; do NOT interpret that as "done".
                // This phase indicates server-side validation / finalization is in progress.
                phaseLocal = "validating"
                setProgress({ phase: "validating", doneCount: Math.max(doneCount, planLen), activeIdx: null })
                setStages((prev) => ({ ...prev, validate: "in_progress" }))
              }
              if (sig.phase === "validate" && sig.state === "end") {
                if (process.env.NODE_ENV !== "production") console.debug("[agent-ui]", "validate:end")
                setStages((prev) => ({ ...prev, validate: "done" }))
              }
              if (sig.phase === "inputSpec" && sig.state === "start") {
                if (process.env.NODE_ENV !== "production") console.debug("[agent-ui]", "inputSpec:start")
                phaseLocal = "inputSpec"
                setProgress({ phase: "inputSpec", doneCount: Math.max(doneCount, planLen), activeIdx: null })
                setStages((prev) => ({ ...prev, inputSpec: "in_progress" }))
              }
              if (sig.phase === "inputSpec" && sig.state === "end") {
                setStages((prev) => ({ ...prev, inputSpec: "done" }))
              }
              if (sig.phase === "outputsSpec" && sig.state === "start") {
                if (process.env.NODE_ENV !== "production") console.debug("[agent-ui]", "outputsSpec:start")
                phaseLocal = "outputsSpec"
                setProgress({ phase: "outputsSpec", doneCount: Math.max(doneCount, planLen), activeIdx: null })
                setStages((prev) => ({ ...prev, outputsSpec: "in_progress" }))
              }
              if (sig.phase === "outputsSpec" && sig.state === "end") {
                setStages((prev) => ({ ...prev, outputsSpec: "done" }))
              }
            } else if (ev.event === "draft_step") {
              const stepRaw = isRecord(ev.data) ? ev.data.step : null
              const step = isRecord(stepRaw) ? (stepRaw as WorkflowStep) : null
              if (!step?.stepKey) continue
              if (!hasPlan || !draftingStarted) {
                bufferedDraftSteps.push(step)
                continue
              }
              // Apply any buffered steps first (should be rare once draftingStarted is true).
              for (const s of bufferedDraftSteps.splice(0, bufferedDraftSteps.length)) applyDraftStep(s)
              applyDraftStep(step)
              doneCount += 1
              // If we are drafting, planning is effectively complete (even if ui(plan,end) was missing).
              setStages((prev) => ({
                ...prev,
                plan: prev.plan === "failed" ? "failed" : "done",
                draft: prev.draft === "todo" ? "in_progress" : prev.draft,
              }))
              setProgress((prev) => {
                // If we're currently validating, keep that phase; only update counts.
                if (prev.phase === "validating" || prev.phase === "inputSpec" || prev.phase === "outputsSpec") {
                  return { ...prev, doneCount, activeIdx: null }
                }
                return { phase: "drafting", doneCount, activeIdx: doneCount < planLen ? doneCount : null }
              })
              phaseLocal = "drafting"
              // Deterministic transition: once we have all planned steps, move to validating stage
              // even if the model forgets to emit ui(draft,end).
              if (planLen > 0 && doneCount >= planLen) {
                phaseLocal = "validating"
                setStages((prev) => ({
                  ...prev,
                  draft: "done",
                  validate: prev.validate === "todo" ? "in_progress" : prev.validate,
                }))
                setProgress({ phase: "validating", doneCount: Math.max(doneCount, planLen), activeIdx: null })
              }
            } else if (ev.event === "done") {
              // Backend has finished streaming; finalize UI state eagerly.
              doneCount = Math.max(doneCount, planLen)
              // If we're still generating inputSpec/outputsSpec, do not flip to done prematurely.
              setProgress((prev) => {
                if (prev.phase === "inputSpec" || prev.phase === "outputsSpec") return prev
                return { phase: "done", doneCount, activeIdx: null }
              })
              setStages((prev) => ({
                ...prev,
                plan: prev.plan === "todo" ? "done" : prev.plan,
                draft: prev.draft === "todo" ? "done" : prev.draft === "in_progress" ? "done" : prev.draft,
                validate: prev.validate === "in_progress" ? "done" : prev.validate,
                inputSpec: prev.inputSpec === "in_progress" ? "done" : prev.inputSpec,
                outputsSpec: prev.outputsSpec === "in_progress" ? "done" : prev.outputsSpec,
              }))
              didReceiveTerminalEvent = true
              shouldStopAfterBatch = true
            } else if (ev.event === "error") {
              if (!dismissedQueuedToast) {
                toast.dismiss(queuedToastId)
                dismissedQueuedToast = true
              }
              const code = readRecordStringField(ev.data, "code") ?? "AGENT_STREAM_FAILED"
              toast.error(tError({ t, code, fallbackKey: "common.error" }))
              didReceiveErrorEvent = true
              setStages((prev) => {
                // Prefer explicit validation failure routing.
                if (code === "WORKFLOW_VALIDATION_FAILED") return { ...prev, validate: "failed" }
                if (phaseLocal === "inputSpec") return { ...prev, inputSpec: "failed" }
                if (phaseLocal === "outputsSpec") return { ...prev, outputsSpec: "failed" }
                if (phaseLocal === "validating") return { ...prev, validate: "failed" }
                if (phaseLocal === "drafting") return { ...prev, draft: "failed" }
                if (phaseLocal === "planning" || phaseLocal === "planned") return { ...prev, plan: "failed" }
                return prev
              })
            }
          }

          // IMPORTANT: do not abort mid-batch; otherwise we can miss ui(validate,end) / done emitted right after proposal.
          if (shouldStopAfterBatch) {
            try {
              await reader.cancel()
            } catch {}
            break
          }
        }

        // If the stream ends without an explicit terminal event, do NOT mark the whole plan as done.
        // This can happen due to network issues, model truncation, or server-side limits.
        if (!didReceiveTerminalEvent) {
          const isPartial = planLen > 0 && doneCount < planLen
          setProgress((prev) => {
            // If we never entered drafting, keep "planned"; otherwise keep "drafting".
            if (prev.phase === "drafting")
              return { phase: "drafting", doneCount, activeIdx: doneCount < planLen ? doneCount : null }
            if (prev.phase === "planned" || prev.phase === "planning") return { ...prev, doneCount: 0, activeIdx: null }
            return prev
          })
          if (!didReceiveErrorEvent && isPartial) {
            toast.error(t("workflows.orchestrator.streamEndedEarly", { done: doneCount, total: planLen }))
          }
        }
      } catch (e) {
        if (!dismissedQueuedToast) toast.dismiss(queuedToastId)
        toast.error(
          e instanceof ApiError
            ? tError({ t, code: e.code, fallbackKey: "common.error" })
            : e instanceof Error
              ? e.message
              : String(e),
        )
      } finally {
        setPending(false)
        // Do not force "done" here; keep progress truthful and let explicit `done`/`proposal` events
        // drive the terminal state. This prevents "phantom completion" for partial drafts.
      }
      */
    },
    [agentRunId, input, pending, messages, workflowId, locale, t, plan, stepsForGraph],
  )

  // Auto-send prompt exactly once.
  // - Prefer `initialPrompt` (dialog/modal flows; do not touch URL)
  // - Otherwise use `?prompt=` and then clean the URL (page flows)
  const didAutoSendRef = React.useRef(false)
  React.useEffect(() => {
    if (didAutoSendRef.current) return
    const prompt = (initialPrompt ?? promptFromUrl ?? promptFromSessionStorage)?.trim()
    if (!prompt) return
    if (pending) return
    didAutoSendRef.current = true
    const shouldCleanUrl = !initialPrompt && Boolean(promptFromUrl)
    void send(prompt)
    if (shouldCleanUrl) {
      const basePath = workflowId ? `/workflows/${workflowId}/agent` : "/agent"
      router.replace(basePath)
    }
  }, [initialPrompt, promptFromUrl, promptFromSessionStorage, workflowId, pending, router, send])

  const saveFromCurrentState = React.useCallback(
    async (opts?: { redirect?: boolean }) => {
      const redirect = opts?.redirect ?? true
      if (saving) return false
      setSaving(true)
      let didRedirect = false
      try {
        const draft = readDraftObject(proposal)

        const looksLikeSlug = (s: string) => /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(s)
        const toTitleFromSlug = (s: string) =>
          s
            .split("-")
            .filter(Boolean)
            .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
            .join(" ")

        const payload = {
          name: (() => {
            const raw =
              typeof draft?.name === "string"
                ? String(draft.name).trim()
                : typeof workflow?.name === "string"
                  ? String(workflow.name).trim()
                  : ""
            if (!raw) return t("workflows.newWorkflowName")
            if (looksLikeSlug(raw)) {
              if (String(locale).toLowerCase().includes("zh")) return t("workflows.newWorkflowName")
              return toTitleFromSlug(raw)
            }
            return raw
          })(),
          description:
            typeof draft?.description === "string"
              ? String(draft.description)
              : typeof workflow?.description === "string"
                ? workflow.description
                : "",
          dependencies:
            typeof draft?.dependencies === "string"
              ? String(draft.dependencies)
              : typeof workflow?.dependencies === "string"
                ? workflow.dependencies
                : "{}",
          envJson: typeof draft?.envJson === "string" ? String(draft.envJson) : "{}",
          inputSpec: typeof draft?.inputSpec === "string" ? String(draft.inputSpec) : undefined,
          outputsSpec: typeof draft?.outputsSpec === "string" ? String(draft.outputsSpec) : undefined,
          steps: stepsForGraph,
        }

        const isUpdate = Boolean(workflowId)
        const json = await apiFetchJson<{ workflow?: { id?: string } }>(
          isUpdate ? `/api/workflows/${workflowId}` : "/api/workflows",
          {
            method: isUpdate ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        )

        const id = isUpdate ? workflowId : typeof json?.workflow?.id === "string" ? json.workflow.id : null
        setDirty(false)
        toast.success(t("common.saved"))
        if (redirect && id) {
          didRedirect = true
          router.push(`/workflows/${id}`)
        }
        return true
      } catch (e) {
        toast.error(
          e instanceof ApiError
            ? tError({ t, code: e.code, fallbackKey: "common.error" })
            : e instanceof Error
              ? e.message
              : String(e),
        )
        return false
      } finally {
        // If we're navigating away, keep UI disabled until the new page loads.
        if (!didRedirect) setSaving(false)
      }
    },
    [saving, proposal, workflow, stepsForGraph, workflowId, locale, t],
  )

  const resetChat = React.useCallback(() => {
    setMessages([])
    setPlan(null)
    setProposal(null)
    setInput("")
    setSelectedStepKey(null)
    setStepSheetOpen(false)
    setGraphOverrideSteps([])
    setDirty(false)
  }, [])

  const updateDraftStep = React.useCallback(
    (stepKey: string, patch: Partial<WorkflowStep>) => {
      const nextSteps = stepsForGraph.map((s) => (s.stepKey === stepKey ? { ...s, ...patch } : s))
      setDirty(true)
      setProposal((prev) => {
        if (!prev) return prev
        const draft = isRecord(prev.draft) ? (prev.draft as Record<string, unknown>) : null
        if (!draft || !Array.isArray(draft.steps)) return prev
        return { ...prev, draft: { ...draft, steps: nextSteps } }
      })
      setWorkflow((prev) => {
        if (!prev) return prev
        const showingDraft = Array.isArray(readDraftSteps(proposal))
        if (showingDraft) return prev
        return { ...prev, steps: nextSteps }
      })
    },
    [stepsForGraph, proposal],
  )

  const renameDraftStepKey = React.useCallback(
    (oldKey: string, nextKey: string) => {
      if (!nextKey) return
      if (nextKey === oldKey) return
      if (stepsForGraph.some((s) => s.stepKey === nextKey)) return
      const nextSteps = stepsForGraph.map((s) => {
        if (s.stepKey === oldKey) return { ...s, stepKey: nextKey }
        const deps = s.deps ?? []
        if (!deps.includes(oldKey)) return s
        return { ...s, deps: deps.map((d) => (d === oldKey ? nextKey : d)) }
      })
      setDirty(true)
      setSelectedStepKey(nextKey)
      setProposal((prev) => {
        if (!prev) return prev
        const draft = isRecord(prev.draft) ? (prev.draft as Record<string, unknown>) : null
        if (!draft || !Array.isArray(draft.steps)) return prev
        return { ...prev, draft: { ...draft, steps: nextSteps } }
      })
      setWorkflow((prev) => {
        if (!prev) return prev
        const showingDraft = Array.isArray(readDraftSteps(proposal))
        if (showingDraft) return prev
        return { ...prev, steps: nextSteps }
      })
    },
    [stepsForGraph, proposal],
  )

  return {
    // refs used by UI
    listRef,
    inputRef,

    // editor config
    monacoTheme,

    // workflow panel
    workflow,
    workflowLoading,
    stepsForGraph,
    draftStepsProgress: Array.isArray(graphOverrideSteps) ? graphOverrideSteps : null,
    isDirty: dirty,
    selectedStepKey,
    setSelectedStepKey,
    selectedStep,
    stepSheetOpen,
    setStepSheetOpen,

    // chat session
    messages,
    proposal,
    plan,
    progress,
    stages,
    hasAssistantOutput,
    agentRunError,
    input,
    setInput: (v: string) => setInput(v),
    pending,
    saving,

    send,
    saveFromCurrentState,
    resetChat,
    updateDraftStep,
    renameDraftStepKey,
  }
}
