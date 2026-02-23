"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useChat } from "@ai-sdk/react"
import {
  DefaultChatTransport,
  isToolUIPart,
  getToolName,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai"

import { toast } from "@/lib/client/toast"
import { ApiError, apiFetchJson } from "@/lib/shared/http/api"
import { tError } from "@/lib/shared/i18n/error"
import { MAIA_MONACO_THEME_DARK, MAIA_MONACO_THEME_LIGHT } from "@/lib/client/monaco"

import {
  type WorkflowStep,
  type WorkflowForPanel,
  type ProposalState,
  type PlanPreviewStep,
  extractPlanFromMessages,
  extractPlanPreviewSteps,
  extractDraftStepsFromMessages,
  extractProposalFromMessages,
  extractSavedWorkflowIdFromMessages,
  deriveStageStatus,
  readDraftSteps,
  readDraftObject,
} from "./orchestrator-state"

import { isRecord } from "@/lib/shared/lang/is-record"

export type { WorkflowStep, WorkflowForPanel, ProposalState } from "./orchestrator-state"
export type { OrchestratorPlanStep, OrchestratorPlan, PlanPreviewStep } from "./orchestrator-state"

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

import { DEFAULT_CHAT_MODEL } from "@/lib/shared/models"
import { type AgentMode, DEFAULT_AGENT_MODE } from "@/lib/shared/agent/modes"

export function useWorkflowAgentSession(params: {
  chatId?: string | null
  workflowId?: string
  locale: string
  t: (k: string, vars?: Record<string, string | number>) => string
  initialPrompt?: string | null
  initialMessages?: UIMessage[]
  initialModel?: string
  initialMode?: AgentMode
  initialChatTitle?: string
  initialChatDescription?: string
}) {
  const { chatId: chatIdProp, workflowId: workflowIdProp, locale, t, initialPrompt, initialMessages } = params

  const router = useRouter()

  const chatIdRef = React.useRef(chatIdProp || crypto.randomUUID())
  const stableChatId = chatIdProp || chatIdRef.current

  const didAutoSendRef = React.useRef(false)
  const didAttemptInitialHandoffRef = React.useRef(false)
  const initialHandoffRef = React.useRef<{ idempotencyKey: string; acknowledged: boolean } | null>(null)
  const claimingInitialHandoffRef = React.useRef(false)
  const initialStepsRef = React.useRef<WorkflowStep[] | null>(null)
  const publicIdRef = React.useRef<string | null>(null)
  const didCanonicalRedirectRef = React.useRef(false)
  const lastStableChatIdRef = React.useRef<string | null>(null)

  const [effectiveWorkflowId, setEffectiveWorkflowId] = React.useState<string | undefined>(workflowIdProp)
  React.useEffect(() => setEffectiveWorkflowId(workflowIdProp), [workflowIdProp])

  const [chatTitle, setChatTitle] = React.useState(() => String(params.initialChatTitle ?? "").trim())
  const [chatDescription, setChatDescription] = React.useState(() => String(params.initialChatDescription ?? "").trim())

  const [model, setModelState] = React.useState<string>(
    () => String(params.initialModel ?? "").trim() || DEFAULT_CHAT_MODEL,
  )

  const [mode, setModeState] = React.useState<AgentMode>(() => params.initialMode ?? DEFAULT_AGENT_MODE)

  const shouldAutoContinueToolChain = React.useCallback(({ messages }: { messages: UIMessage[] }): boolean => {
    // AI SDK best practice: auto-continue when all tool results are available.
    // - lastAssistantMessageIsCompleteWithToolCalls: handles addToolOutput (plan_ready, suggest_mode_switch, etc.)
    // - lastAssistantMessageIsCompleteWithApprovalResponses: handles addToolApprovalResponse (tool approval flow)
    return (
      lastAssistantMessageIsCompleteWithToolCalls({ messages }) ||
      lastAssistantMessageIsCompleteWithApprovalResponses({ messages })
    )
  }, [])

  const setModel = React.useCallback(
    (next: string) => {
      setModelState(next)
      if (!chatIdProp) return
      apiFetchJson(`/api/chats/${encodeURIComponent(stableChatId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: next }),
      }).catch((e) => {
        if (e instanceof ApiError && e.code === "NOT_FOUND") return
        toast.error(t("common.error"))
      })
    },
    [chatIdProp, stableChatId, t],
  )

  const setMode = React.useCallback(
    (next: AgentMode) => {
      setModeState(next)
      bodyRef.current = { ...bodyRef.current, mode: next }
      if (!chatIdProp) return
      apiFetchJson(`/api/chats/${encodeURIComponent(stableChatId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentMode: next }),
      }).catch((e) => {
        if (e instanceof ApiError && e.code === "NOT_FOUND") return
        toast.error(t("common.error"))
      })
    },
    [chatIdProp, stableChatId, t],
  )

  const bodyRef = React.useRef({ chatId: stableChatId, workflowId: effectiveWorkflowId, locale, model, mode })
  React.useEffect(() => {
    bodyRef.current = { chatId: stableChatId, workflowId: effectiveWorkflowId, locale, model, mode }
  }, [stableChatId, effectiveWorkflowId, locale, model, mode])

  const transport = React.useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => bodyRef.current,
        fetch: async (input, init) => {
          const res = await fetch(input, init)
          const pid = res.headers.get("x-maia-chat-public-id") || res.headers.get("X-Maia-Chat-Public-Id")
          if (pid && !publicIdRef.current) publicIdRef.current = pid
          return res
        },
      }),
    [],
  )

  const chat = useChat({
    id: stableChatId,
    transport,
    messages: initialMessages,
    experimental_throttle: 48,
    sendAutomaticallyWhen: shouldAutoContinueToolChain,
    onData: (dataPart) => {
      const part = dataPart as { type?: string; data?: unknown }
      if (part.type === "data-chat-title" && typeof part.data === "string") {
        setChatTitle(part.data.trim())
      }
      if (part.type === "data-chat-description" && typeof part.data === "string") {
        setChatDescription(part.data.trim())
      }
    },
    onFinish: () => {
      if (chatIdProp) return
      if (didCanonicalRedirectRef.current) return
      const pid = publicIdRef.current
      if (!pid) return
      didCanonicalRedirectRef.current = true
      const wid = String(effectiveWorkflowId ?? workflowIdProp ?? "").trim()
      const qs = wid ? `?workflowId=${encodeURIComponent(wid)}` : ""
      router.replace(`/agent/${encodeURIComponent(pid)}${qs}`)
    },
  })

  // Derive orchestrator state from AI SDK message parts
  const plan = React.useMemo(() => extractPlanFromMessages(chat.messages), [chat.messages])
  const planPreviewSteps = React.useMemo(() => extractPlanPreviewSteps(chat.messages), [chat.messages])
  const draftStepsFromStream = React.useMemo(() => extractDraftStepsFromMessages(chat.messages), [chat.messages])
  const proposal = React.useMemo(() => extractProposalFromMessages(chat.messages), [chat.messages])

  const chatPending = chat.status === "submitted" || chat.status === "streaming"

  const stageStatus = React.useMemo(() => deriveStageStatus(chat.messages, chatPending), [chat.messages, chatPending])

  // Detect define_step streaming activity.
  // `streamingStepKey`: the stepKey being generated (null when partial JSON hasn't reached it yet).
  // `isDefineStepActive`: true as soon as AI SDK sees the tool call header, BEFORE stepKey is parseable.
  const { streamingStepKey: streamingDefineStepKey, isActive: isDefineStepActive } = React.useMemo(() => {
    if (!chatPending) return { streamingStepKey: null, isActive: false }
    const lastMsg = chat.messages[chat.messages.length - 1]
    if (!lastMsg || lastMsg.role !== "assistant") return { streamingStepKey: null, isActive: false }
    for (let i = lastMsg.parts.length - 1; i >= 0; i--) {
      const part = lastMsg.parts[i]!
      if (!isToolUIPart(part)) continue
      if (getToolName(part) !== "define_step") continue
      if (part.state === "input-streaming" || part.state === "input-available") {
        const inp = isRecord(part.input) ? (part.input as Record<string, unknown>) : null
        const step = isRecord(inp?.step) ? (inp.step as Record<string, unknown>) : null
        const key = step && typeof step.stepKey === "string" ? step.stepKey : null
        return { streamingStepKey: key, isActive: true }
      }
    }
    return { streamingStepKey: null, isActive: false }
  }, [chat.messages, chatPending])

  // Track define_step lifecycle for the CURRENT user turn only.
  // AI SDK streams tool parts incrementally; by scoping to the latest user turn we avoid
  // historical define_step outputs from older turns masking loading/check states in edits.
  const { completedDefineStepKeys, failedDefineStepKeys, redraftingStepKeys } = React.useMemo(() => {
    const completed = new Set<string>()
    const failed = new Set<string>()
    const redrafting = new Set<string>()

    const lastUserMsgIdx = (() => {
      for (let i = chat.messages.length - 1; i >= 0; i--) {
        if (chat.messages[i]?.role === "user") return i
      }
      return -1
    })()
    const turnMessages = lastUserMsgIdx >= 0 ? chat.messages.slice(lastUserMsgIdx + 1) : chat.messages

    // Collect the last define_step state per stepKey (ordered by message/part appearance).
    const lastStateByKey = new Map<string, string>()
    const lastOutputByKey = new Map<string, Record<string, unknown> | null>()
    for (const msg of turnMessages) {
      for (const part of msg.parts) {
        if (!isToolUIPart(part) || getToolName(part) !== "define_step") continue
        const inp = isRecord(part.input) ? (part.input as Record<string, unknown>) : null
        const step = isRecord(inp?.step) ? (inp.step as Record<string, unknown>) : null
        const key = step && typeof step.stepKey === "string" ? step.stepKey : null
        if (!key) continue
        lastStateByKey.set(key, part.state)
        lastOutputByKey.set(
          key,
          part.state === "output-available" && isRecord(part.output) ? (part.output as Record<string, unknown>) : null,
        )
      }
    }

    for (const [key, state] of lastStateByKey) {
      if (state === "output-available") {
        const output = lastOutputByKey.get(key)
        if (output && output.ok === false) {
          failed.add(key)
        } else {
          completed.add(key)
        }
      } else if (state === "output-denied" || state === "output-error") {
        failed.add(key)
      } else if (state === "input-streaming" || state === "input-available") {
        redrafting.add(key)
      }
    }

    return { completedDefineStepKeys: completed, failedDefineStepKeys: failed, redraftingStepKeys: redrafting }
  }, [chat.messages])

  // Workflow panel state
  const [workflow, setWorkflow] = React.useState<WorkflowForPanel | null>(null)
  const [workflowLoading, setWorkflowLoading] = React.useState(false)
  const [selectedStepKey, setSelectedStepKey] = React.useState<string | null>(null)
  const [stepSheetOpen, setStepSheetOpen] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [localStepOverrides, setLocalStepOverrides] = React.useState<WorkflowStep[] | null>(null)

  // Refs
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)

  // Sticky auto-scroll – Vercel AI SDK chatbot pattern.
  // Uses MutationObserver + ResizeObserver to react to actual DOM/size
  // changes, and tracks user-initiated scrolling so that content-height
  // fluctuations during streaming never falsely disengage auto-follow.
  const isAtBottomRef = React.useRef(true)
  const isUserScrollingRef = React.useRef(false)
  const scrollCleanupRef = React.useRef<(() => void) | null>(null)
  const scrollContainerRef = React.useCallback((node: HTMLDivElement | null) => {
    scrollCleanupRef.current?.()
    scrollCleanupRef.current = null
    if (!node) return
    const viewport = node.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!viewport) return

    const THRESHOLD = 100

    const checkIfAtBottom = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport
      return scrollTop + clientHeight >= scrollHeight - THRESHOLD
    }

    let isProgrammaticScroll = false
    const scrollToBottom = () => {
      isProgrammaticScroll = true
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "instant" as ScrollBehavior })
      isProgrammaticScroll = false
      isAtBottomRef.current = true
    }

    let scrollTimeout: ReturnType<typeof setTimeout>
    const handleScroll = () => {
      if (isProgrammaticScroll) return
      isUserScrollingRef.current = true
      clearTimeout(scrollTimeout)
      isAtBottomRef.current = checkIfAtBottom()
      scrollTimeout = setTimeout(() => {
        isUserScrollingRef.current = false
      }, 150)
    }

    viewport.addEventListener("scroll", handleScroll, { passive: true })

    const scrollIfNeeded = () => {
      if (isAtBottomRef.current && !isUserScrollingRef.current) {
        requestAnimationFrame(scrollToBottom)
      }
    }

    const mutationObserver = new MutationObserver(scrollIfNeeded)
    mutationObserver.observe(viewport, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    const resizeObserver = new ResizeObserver(scrollIfNeeded)
    resizeObserver.observe(viewport)
    for (const child of viewport.children) {
      resizeObserver.observe(child)
    }

    isAtBottomRef.current = checkIfAtBottom()

    scrollCleanupRef.current = () => {
      viewport.removeEventListener("scroll", handleScroll)
      clearTimeout(scrollTimeout)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [])

  type FileUIPart = Extract<UIMessage["parts"][number], { type: "file" }>

  // Monaco theme
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

  // Load workflow for edit mode
  React.useEffect(() => {
    if (!effectiveWorkflowId) return
    let canceled = false
    setWorkflowLoading(true)
    apiFetchJson<{ workflow?: WorkflowForPanel | null }>(`/api/workflows/${effectiveWorkflowId}`, { cache: "no-store" })
      .then((j) => {
        if (canceled) return
        const wf = (j?.workflow ?? null) as WorkflowForPanel | null
        setWorkflow(wf)
        setSelectedStepKey((prev) => prev ?? wf?.steps?.[0]?.stepKey ?? null)
        setDirty(false)
      })
      .catch(() => {})
      .finally(() => {
        if (!canceled) setWorkflowLoading(false)
      })
    return () => {
      canceled = true
    }
  }, [effectiveWorkflowId])

  // Pre-compute steps from initialMessages as a stable fallback
  if (initialStepsRef.current === null && initialMessages?.length) {
    const initProposal = extractProposalFromMessages(initialMessages)
    const initProposalSteps = readDraftSteps(initProposal)
    if (initProposalSteps?.length) {
      initialStepsRef.current = initProposalSteps
    } else {
      const initDraftSteps = extractDraftStepsFromMessages(initialMessages)
      initialStepsRef.current = initDraftSteps.length ? initDraftSteps : null
    }
  }

  // Steps for graph: local overrides > proposal draft > stream draft > plan preview > initial fallback > workflow
  const stepsForGraph = React.useMemo((): WorkflowStep[] => {
    if (localStepOverrides) return localStepOverrides
    const proposalSteps = readDraftSteps(proposal)
    if (proposalSteps?.length) return proposalSteps
    if (draftStepsFromStream.length) {
      if (planPreviewSteps) {
        const planDepsByKey = new Map(planPreviewSteps.map((p) => [p.stepKey, p.deps]))
        const draftedKeys = new Set(draftStepsFromStream.map((s) => s.stepKey))

        // Models often omit deps in define_step even though create_plan had them.
        // Inherit plan preview deps for any drafted step that has empty deps.
        const mergedDraftSteps = draftStepsFromStream.map((s) => {
          if (s.deps.length === 0) {
            const planDeps = planDepsByKey.get(s.stepKey)
            if (planDeps && planDeps.length > 0) {
              return { ...s, deps: planDeps }
            }
          }
          return s
        })

        const remaining = planPreviewSteps
          .filter((p) => !draftedKeys.has(p.stepKey))
          .map(
            (p): WorkflowStep => ({
              stepKey: p.stepKey,
              name: p.name,
              scriptEsm: "",
              deps: p.deps,
            }),
          )
        // When the AI has built at least as many steps as planned, any unmatched
        // plan preview keys are stale renames (AI changed stepKey between plan and
        // build). Drop them to avoid phantom draft nodes on the canvas.
        if (remaining.length > 0 && mergedDraftSteps.length >= planPreviewSteps.length) {
          return mergedDraftSteps
        }
        return [...mergedDraftSteps, ...remaining]
      }
      // Edit mode: merge streamed drafts with original workflow steps so that
      // unmodified steps remain visible on the canvas.
      if (workflow?.steps?.length) {
        const draftByKey = new Map(draftStepsFromStream.map((s) => [s.stepKey, s]))
        const merged = workflow.steps.map((original) => draftByKey.get(original.stepKey) ?? original)
        const originalKeys = new Set(workflow.steps.map((s) => s.stepKey))
        const added = draftStepsFromStream.filter((s) => !originalKeys.has(s.stepKey))
        return [...merged, ...added]
      }
      return draftStepsFromStream
    }
    if (planPreviewSteps) {
      return planPreviewSteps.map(
        (p): WorkflowStep => ({
          stepKey: p.stepKey,
          name: p.name,
          scriptEsm: "",
          deps: p.deps,
        }),
      )
    }
    if (initialStepsRef.current?.length) return initialStepsRef.current
    return workflow?.steps ?? []
  }, [localStepOverrides, proposal, draftStepsFromStream, planPreviewSteps, workflow])

  // Current-turn define_step activity only (AI SDK tool-part lifecycle).
  // This avoids historical draft state from older turns leaking into
  // the loading indicator right after the next user send.
  const hasCurrentTurnDefineActivity = React.useMemo(() => {
    return (
      isDefineStepActive ||
      completedDefineStepKeys.size > 0 ||
      failedDefineStepKeys.size > 0 ||
      redraftingStepKeys.size > 0
    )
  }, [isDefineStepActive, completedDefineStepKeys, failedDefineStepKeys, redraftingStepKeys])

  const isDraftLoadingByKey = React.useMemo((): Record<string, boolean> => {
    // Primary: we know the exact stepKey being streamed
    if (streamingDefineStepKey) {
      return { [streamingDefineStepKey]: true }
    }
    // Show loading for any step currently being redrafted (AI fixing a previously completed step)
    if (chatPending && redraftingStepKeys.size > 0) {
      const result: Record<string, boolean> = {}
      for (const key of redraftingStepKeys) result[key] = true
      return result
    }
    // Fallback: define_step is active (tool call header seen) but stepKey not yet
    // parseable from partial JSON, OR we're between auto-continue streams.
    // Show spinner on the first uncompleted step by order.
    if (!chatPending) return {}
    const hasAnyDefineStep = hasCurrentTurnDefineActivity
    if (!hasAnyDefineStep) return {}

    const candidateSteps = planPreviewSteps ?? stepsForGraph
    if (candidateSteps.length === 0) return {}
    for (const step of candidateSteps) {
      if (!completedDefineStepKeys.has(step.stepKey) && !failedDefineStepKeys.has(step.stepKey)) {
        return { [step.stepKey]: true }
      }
    }
    return {}
  }, [
    streamingDefineStepKey,
    chatPending,
    planPreviewSteps,
    completedDefineStepKeys,
    failedDefineStepKeys,
    redraftingStepKeys,
    hasCurrentTurnDefineActivity,
    isDefineStepActive,
    stepsForGraph,
  ])

  // Compute planState for each step node from the same tool-part source used by loading.
  // This keeps node icon transitions consistent with AI SDK streaming states.
  const planStateByKey = React.useMemo((): Record<string, "plan" | "draft" | "complete" | "error"> => {
    // Edit mode (no plan): only touched steps get state badges/icons.
    if (!planPreviewSteps) {
      const result: Record<string, "plan" | "draft" | "complete" | "error"> = {}
      for (const step of stepsForGraph) {
        if (failedDefineStepKeys.has(step.stepKey)) {
          result[step.stepKey] = "error"
        } else if (isDraftLoadingByKey[step.stepKey] || redraftingStepKeys.has(step.stepKey)) {
          result[step.stepKey] = "draft"
        } else if (completedDefineStepKeys.has(step.stepKey)) {
          result[step.stepKey] = "complete"
        }
      }
      return result
    }

    // Create mode (has plan): plan → draft → complete/error progression.
    const previewKeys = new Set(planPreviewSteps.map((s) => s.stepKey))
    const hasDraftActivity = hasCurrentTurnDefineActivity
    const result: Record<string, "plan" | "draft" | "complete" | "error"> = {}

    for (const step of stepsForGraph) {
      if (failedDefineStepKeys.has(step.stepKey)) {
        result[step.stepKey] = "error"
      } else if (isDraftLoadingByKey[step.stepKey] || redraftingStepKeys.has(step.stepKey)) {
        result[step.stepKey] = "draft"
      } else if (completedDefineStepKeys.has(step.stepKey)) {
        result[step.stepKey] = "complete"
      } else if (previewKeys.has(step.stepKey)) {
        result[step.stepKey] = hasDraftActivity ? "draft" : "plan"
      }
    }
    return result
  }, [
    planPreviewSteps,
    stepsForGraph,
    failedDefineStepKeys,
    isDraftLoadingByKey,
    redraftingStepKeys,
    completedDefineStepKeys,
    hasCurrentTurnDefineActivity,
    isDefineStepActive,
  ])

  // Set dirty when draft steps stream in
  React.useEffect(() => {
    if (proposal?.ok || draftStepsFromStream.length > 0) setDirty(true)
  }, [proposal, draftStepsFromStream])

  // Capture workflowId after the agent saves via tool
  React.useEffect(() => {
    const savedId = extractSavedWorkflowIdFromMessages(chat.messages)
    if (!savedId) return
    setEffectiveWorkflowId((prev) => (prev === savedId ? prev : savedId))
    setDirty(false)
  }, [chat.messages])

  const selectedStep = React.useMemo(
    () => (selectedStepKey ? (stepsForGraph.find((s) => s.stepKey === selectedStepKey) ?? null) : null),
    [stepsForGraph, selectedStepKey],
  )

  const pending = chatPending
  const stop = chat.stop

  // Reset per-chat state when switching chats without a full remount
  React.useEffect(() => {
    const prevChatId = lastStableChatIdRef.current
    lastStableChatIdRef.current = stableChatId
    // On first mount, there is no previous chat to tear down.
    if (prevChatId == null) return
    if (prevChatId === stableChatId) return

    didAutoSendRef.current = false
    didAttemptInitialHandoffRef.current = false
    initialHandoffRef.current = null
    claimingInitialHandoffRef.current = false
    initialStepsRef.current = null
    publicIdRef.current = null
    didCanonicalRedirectRef.current = false
    setChatTitle("")
    setEffectiveWorkflowId(workflowIdProp)
    setWorkflow(null)
    setLocalStepOverrides(null)
    setDirty(false)
    setSelectedStepKey(null)
    setStepSheetOpen(false)
    try {
      stop()
    } catch {
      /* ignore */
    }
  }, [stableChatId, stop])

  // Send message
  const send = React.useCallback(
    (overrideText?: string, files?: FileUIPart[]) => {
      const text = String(overrideText ?? "").trim()
      const fs = Array.isArray(files) ? files : []
      if (pending) return
      if (!text && fs.length === 0) return
      isAtBottomRef.current = true
      isUserScrollingRef.current = false
      if (text) {
        chat.sendMessage({ text, files: fs.length ? fs : undefined })
        return
      }
      chat.sendMessage({ files: fs })
    },
    [pending, chat],
  )
  const latestSendRef = React.useRef(send)
  React.useEffect(() => {
    latestSendRef.current = send
  }, [send])

  const editUserMessage = React.useCallback(
    async (messageId: string, nextText: string, nextFiles?: FileUIPart[]) => {
      if (chatPending) return false
      const trimmedId = String(messageId || "").trim()
      if (!trimmedId) return false

      const current = chat.messages
      const targetIdx = current.findIndex((m) => m.id === trimmedId && m.role === "user")
      if (targetIdx < 0) return false

      const target = current[targetIdx]!
      const preservedOtherParts = target.parts.filter((p) => p.type !== "text" && p.type !== "file")
      const normalizedText = String(nextText ?? "")
      const normalizedFiles = (
        Array.isArray(nextFiles) ? nextFiles : target.parts.filter((p): p is FileUIPart => p.type === "file")
      )
        .map((f) => ({
          type: "file" as const,
          url: String(f.url || "").trim(),
          mediaType: String(f.mediaType || "application/octet-stream"),
          filename: typeof f.filename === "string" ? f.filename : undefined,
        }))
        .filter((f) => f.url.length > 0)
      const hasFilesOrOtherParts = normalizedFiles.length > 0 || preservedOtherParts.length > 0
      if (!normalizedText.trim() && !hasFilesOrOtherParts) return false

      const rewritten: UIMessage = {
        ...target,
        parts: [
          ...normalizedFiles,
          ...(normalizedText.trim() ? ([{ type: "text", text: normalizedText }] as UIMessage["parts"]) : []),
          ...preservedOtherParts,
        ] as UIMessage["parts"],
      }

      isAtBottomRef.current = true
      isUserScrollingRef.current = false
      chat.setMessages([...current.slice(0, targetIdx), rewritten])
      try {
        await Promise.resolve(chat.regenerate())
      } catch {
        return false
      }
      return true
    },
    [chat, chatPending],
  )

  // Optional: auto-send a server-provided initialPrompt (used by workflow edit entry points)
  React.useEffect(() => {
    const prompt = (initialPrompt ?? "").trim()
    if (!prompt) return
    if (pending) return
    if (didAutoSendRef.current) return
    didAutoSendRef.current = true
    send(prompt)
  }, [initialPrompt, pending, send])

  // Landing-page handoff: claim initial send payload from DB, then auto-send once.
  React.useEffect(() => {
    if (!chatIdProp) return
    if (didAttemptInitialHandoffRef.current) return
    if (didAutoSendRef.current) return
    if (pending) return
    if (chat.messages.length > 0) return
    if (claimingInitialHandoffRef.current) return

    let canceled = false
    claimingInitialHandoffRef.current = true
    ;(async () => {
      try {
        const res = await apiFetchJson<{
          handoff?: {
            text?: string
            files?: Array<{ url?: string; mediaType?: string; filename?: string }>
            idempotencyKey?: string
          } | null
        }>(`/api/chats/${encodeURIComponent(stableChatId)}/initial-send`, { method: "GET" })
        if (canceled) return
        const handoff = res?.handoff
        if (!handoff) return

        const text = String(handoff.text ?? "").trim()
        const files = (Array.isArray(handoff.files) ? handoff.files : [])
          .map((x) => ({
            type: "file" as const,
            url: typeof x?.url === "string" ? x.url : "",
            mediaType: typeof x?.mediaType === "string" ? x.mediaType : "application/octet-stream",
            filename: typeof x?.filename === "string" ? x.filename : undefined,
          }))
          .filter((f) => Boolean(f.url))
        if (!text && files.length === 0) return

        didAutoSendRef.current = true
        initialHandoffRef.current = {
          idempotencyKey: String(handoff.idempotencyKey ?? "").trim() || crypto.randomUUID(),
          acknowledged: false,
        }
        latestSendRef.current(text, files.length ? files : undefined)
      } catch {
        // Best effort; no toast for silent startup handoff.
      } finally {
        // Keep this one-attempt-per-chat after async completes so Strict Mode's
        // throwaway pass can retry while normal re-renders stay idempotent.
        if (!canceled) didAttemptInitialHandoffRef.current = true
        claimingInitialHandoffRef.current = false
      }
    })()
    return () => {
      canceled = true
      // React Strict Mode (dev) runs mount effects twice with an immediate cleanup.
      // Release the local lock so the second effect pass can still claim+send.
      claimingInitialHandoffRef.current = false
    }
  }, [chatIdProp, pending, chat.messages.length, stableChatId])

  // Mark DB handoff as consumed only after the first user message exists locally.
  React.useEffect(() => {
    if (!chatIdProp) return
    if (!initialHandoffRef.current) return
    if (initialHandoffRef.current.acknowledged) return
    if (chat.messages.length === 0) return
    const hasUserMessage = chat.messages.some((m) => m.role === "user")
    if (!hasUserMessage) return

    initialHandoffRef.current.acknowledged = true
    apiFetchJson(`/api/chats/${encodeURIComponent(stableChatId)}/initial-send`, { method: "POST" }).catch(() => {
      if (initialHandoffRef.current) initialHandoffRef.current.acknowledged = false
    })
  }, [chatIdProp, chat.messages, stableChatId])

  // Save workflow from current state
  const saveFromCurrentState = React.useCallback(
    async (opts?: { redirect?: boolean }) => {
      const redirect = opts?.redirect ?? false
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

        const baselineDepsByKey = new Map(
          (workflow?.steps ?? []).map((s) => [String(s.stepKey), Array.isArray(s.deps) ? s.deps.map(String) : []]),
        )
        const guardedSteps = stepsForGraph.map((s) => {
          if (!effectiveWorkflowId) return s
          const currentDeps = Array.isArray(s.deps) ? s.deps.map(String).filter(Boolean) : []
          if (currentDeps.length > 0) return { ...s, deps: currentDeps }
          const baselineDeps = baselineDepsByKey.get(String(s.stepKey)) ?? []
          // Edit-mode safeguard: if deps are accidentally emptied, preserve original deps.
          if (baselineDeps.length > 0) return { ...s, deps: baselineDeps }
          return { ...s, deps: currentDeps }
        })

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
          steps: guardedSteps,
        }

        const isUpdate = Boolean(effectiveWorkflowId)
        const json = await apiFetchJson<{ workflow?: { id?: string } }>(
          isUpdate ? `/api/workflows/${effectiveWorkflowId}` : "/api/workflows",
          {
            method: isUpdate ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        )

        const id = isUpdate ? effectiveWorkflowId : typeof json?.workflow?.id === "string" ? json.workflow.id : null
        if (id && !effectiveWorkflowId) setEffectiveWorkflowId(id)
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
        if (!didRedirect) setSaving(false)
      }
    },
    [saving, proposal, workflow, stepsForGraph, effectiveWorkflowId, locale, t, router],
  )

  const updateDraftStep = React.useCallback(
    (stepKey: string, patch: Partial<WorkflowStep>) => {
      const nextSteps = stepsForGraph.map((s) => (s.stepKey === stepKey ? { ...s, ...patch } : s))
      setDirty(true)
      setLocalStepOverrides(nextSteps)
    },
    [stepsForGraph],
  )

  const renameDraftStepKey = React.useCallback(
    (oldKey: string, nextKey: string) => {
      if (!nextKey || nextKey === oldKey) return
      if (stepsForGraph.some((s) => s.stepKey === nextKey)) return
      const nextSteps = stepsForGraph.map((s) => {
        if (s.stepKey === oldKey) return { ...s, stepKey: nextKey }
        const deps = s.deps ?? []
        if (!deps.includes(oldKey)) return s
        return { ...s, deps: deps.map((d) => (d === oldKey ? nextKey : d)) }
      })
      setDirty(true)
      setSelectedStepKey(nextKey)
      setLocalStepOverrides(nextSteps)
    },
    [stepsForGraph],
  )

  return {
    chatId: stableChatId,
    chatTitle,
    chatDescription,
    listRef,
    scrollContainerRef,
    inputRef,
    monacoTheme,
    model,
    setModel,
    mode,
    setMode,

    // AI SDK chat state (standard)
    messages: chat.messages,
    status: chat.status,
    error: chat.error,
    stop: chat.stop,

    // Workflow panel
    workflow,
    workflowLoading,
    stepsForGraph,
    draftStepsFromStream,
    planStateByKey,
    isDraftLoadingByKey,
    isDirty: dirty,
    selectedStepKey,
    setSelectedStepKey,
    selectedStep,
    stepSheetOpen,
    setStepSheetOpen,

    // Derived orchestrator state
    plan,
    proposal,
    pending,
    stageStatus,
    saving,

    // Actions
    send,
    sendMessage: chat.sendMessage,
    saveFromCurrentState,
    updateDraftStep,
    renameDraftStepKey,
    editUserMessage,
    addToolOutput: chat.addToolOutput,
    addToolApprovalResponse: chat.addToolApprovalResponse,
  }
}
