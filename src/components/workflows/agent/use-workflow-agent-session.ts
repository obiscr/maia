"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useChat } from "@ai-sdk/react"
import {
  DefaultChatTransport,
  isToolUIPart,
  getToolName,
  lastAssistantMessageIsCompleteWithApprovalResponses,
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
  extractPlanFromMessages,
  extractDraftStepsFromMessages,
  extractProposalFromMessages,
  extractSavedWorkflowIdFromMessages,
  deriveStageStatus,
  readDraftSteps,
  readDraftObject,
} from "./orchestrator-state"

export type { WorkflowStep, WorkflowForPanel, ProposalState } from "./orchestrator-state"
export type { OrchestratorPlanStep, OrchestratorPlan } from "./orchestrator-state"

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

import { DEFAULT_CHAT_MODEL } from "@/lib/shared/models"

export function useWorkflowAgentSession(params: {
  chatId?: string | null
  workflowId?: string
  locale: string
  t: (k: string, vars?: Record<string, string | number>) => string
  initialPrompt?: string | null
  initialMessages?: UIMessage[]
  initialModel?: string
  initialChatTitle?: string
}) {
  const { chatId: chatIdProp, workflowId: workflowIdProp, locale, t, initialPrompt, initialMessages } = params

  const router = useRouter()

  const chatIdRef = React.useRef(chatIdProp || crypto.randomUUID())
  const stableChatId = chatIdProp || chatIdRef.current

  const didAutoSendRef = React.useRef(false)
  const initialHandoffRef = React.useRef<{ idempotencyKey: string; acknowledged: boolean } | null>(null)
  const claimingInitialHandoffRef = React.useRef(false)
  const initialStepsRef = React.useRef<WorkflowStep[] | null>(null)
  const publicIdRef = React.useRef<string | null>(null)
  const didCanonicalRedirectRef = React.useRef(false)
  const lastStableChatIdRef = React.useRef<string | null>(null)

  const [effectiveWorkflowId, setEffectiveWorkflowId] = React.useState<string | undefined>(workflowIdProp)
  React.useEffect(() => setEffectiveWorkflowId(workflowIdProp), [workflowIdProp])

  const [chatTitle, setChatTitle] = React.useState(() => String(params.initialChatTitle ?? "").trim())

  const [model, setModelState] = React.useState<string>(
    () => String(params.initialModel ?? "").trim() || DEFAULT_CHAT_MODEL,
  )

  const shouldAutoContinueToolChain = React.useCallback(({ messages }: { messages: UIMessage[] }): boolean => {
    if (lastAssistantMessageIsCompleteWithApprovalResponses({ messages })) return true

    const last = messages[messages.length - 1]
    if (!last || last.role !== "assistant") return false

    const toolParts = last.parts.filter(isToolUIPart)

    // Do NOT continue after the workflow has been persisted successfully.
    const hasSavedWorkflow = toolParts.some((p) => {
      const n = getToolName(p)
      if (n !== "create_workflow_draft" && n !== "update_workflow_draft") return false
      if (p.state !== "output-available") return false
      const out = p.output
      return out && typeof out === "object" && (out as Record<string, unknown>).ok === true
    })
    if (hasSavedWorkflow) return false

    // Only auto-continue when the orchestrator flow is in progress.
    // For non-orchestrator queries the server-side multi-step loop
    // (stopWhen + prepareStep) handles tool execution completely
    // within a single HTTP request — no client-side kick is needed.
    const ORCHESTRATOR_TOOLS = new Set([
      "set_plan",
      "draft_step",
      "finalize_draft",
      "generate_input_spec",
      "generate_output_spec",
      "get_workflow",
    ])
    const hasCompletedOrchestratorTool = toolParts.some(
      (p) => (p.state === "output-available" || p.state === "output-error") && ORCHESTRATOR_TOOLS.has(getToolName(p)),
    )
    return hasCompletedOrchestratorTool
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

  const bodyRef = React.useRef({ chatId: stableChatId, workflowId: effectiveWorkflowId, locale, model })
  React.useEffect(() => {
    bodyRef.current = { chatId: stableChatId, workflowId: effectiveWorkflowId, locale, model }
  }, [stableChatId, effectiveWorkflowId, locale, model])

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
  const draftStepsFromStream = React.useMemo(() => extractDraftStepsFromMessages(chat.messages), [chat.messages])
  const proposal = React.useMemo(() => extractProposalFromMessages(chat.messages), [chat.messages])

  const chatPending = chat.status === "submitted" || chat.status === "streaming"

  const stageStatus = React.useMemo(() => deriveStageStatus(chat.messages, chatPending), [chat.messages, chatPending])

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

  // Sticky auto-scroll: only scroll when the user is already at the bottom
  const isAtBottomRef = React.useRef(true)
  const scrollCleanupRef = React.useRef<(() => void) | null>(null)
  const scrollRafRef = React.useRef<number | null>(null)
  const lastAutoScrollAtRef = React.useRef(0)
  const pendingRef = React.useRef(false)
  const scrollContainerRef = React.useCallback((node: HTMLDivElement | null) => {
    scrollCleanupRef.current?.()
    scrollCleanupRef.current = null
    if (!node) return
    const viewport = node.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!viewport) return
    const THRESHOLD = 80
    const onScroll = () => {
      isAtBottomRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < THRESHOLD
    }
    viewport.addEventListener("scroll", onScroll, { passive: true })
    onScroll()
    scrollCleanupRef.current = () => viewport.removeEventListener("scroll", onScroll)
  }, [])
  React.useEffect(() => {
    pendingRef.current = chatPending
  }, [chatPending])

  const scheduleAutoScroll = React.useCallback(() => {
    if (!isAtBottomRef.current) return
    if (scrollRafRef.current != null) return
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null
      if (!isAtBottomRef.current) return
      const now = performance.now()
      // Keep streaming scroll updates at ~20fps to avoid layout thrash.
      if (pendingRef.current && now - lastAutoScrollAtRef.current < 50) return
      lastAutoScrollAtRef.current = now
      listRef.current?.scrollIntoView({
        behavior: pendingRef.current ? "auto" : "smooth",
        block: "end",
      })
    })
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

  React.useEffect(() => {
    scheduleAutoScroll()
    return () => {
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
    }
  }, [chat.messages, scheduleAutoScroll])

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

  // Steps for graph: local overrides > proposal draft > stream draft > initial fallback > workflow
  const stepsForGraph = React.useMemo((): WorkflowStep[] => {
    if (localStepOverrides) return localStepOverrides
    const proposalSteps = readDraftSteps(proposal)
    if (proposalSteps?.length) return proposalSteps
    if (draftStepsFromStream.length) return draftStepsFromStream
    if (initialStepsRef.current?.length) return initialStepsRef.current
    return workflow?.steps ?? []
  }, [localStepOverrides, proposal, draftStepsFromStream, workflow])

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
      if (text) {
        chat.sendMessage({ text, files: fs.length ? fs : undefined })
        return
      }
      chat.sendMessage({ files: fs })
    },
    [pending, chat],
  )

  const editUserMessage = React.useCallback(
    async (messageId: string, nextText: string, nextFiles?: FileUIPart[]) => {
      if (pendingRef.current) return false
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
      chat.setMessages([...current.slice(0, targetIdx), rewritten])
      try {
        await Promise.resolve(chat.regenerate())
      } catch {
        return false
      }
      return true
    },
    [chat],
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
        send(text, files.length ? files : undefined)
      } catch {
        // Best effort; no toast for silent startup handoff.
      } finally {
        claimingInitialHandoffRef.current = false
      }
    })()
    return () => {
      canceled = true
      // React Strict Mode (dev) runs mount effects twice with an immediate cleanup.
      // Release the local lock so the second effect pass can still claim+send.
      claimingInitialHandoffRef.current = false
    }
  }, [chatIdProp, pending, chat.messages.length, stableChatId, send])

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
    listRef,
    scrollContainerRef,
    inputRef,
    monacoTheme,
    model,
    setModel,

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
    addToolApprovalResponse: chat.addToolApprovalResponse,
  }
}
