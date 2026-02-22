"use client"
/* @refresh reset */

import * as React from "react"
import { useRouter } from "next/navigation"
import { Bot, History, Pencil, Plus, Save, Trash2Icon } from "lucide-react"
import type { UIMessage } from "ai"

import { useI18n } from "@/components/i18n-provider"
import { Spinner } from "@/components/ui/spinner"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PromptComposer } from "@/components/agent/prompt-composer"
import { cn } from "@/lib/utils"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Card } from "@/components/ui/card"
import { SectionCard } from "@/components/common/section-card"
import { WorkflowGraphCanvasWrapper } from "@/components/graph/workflow-graph-canvas-wrapper"
import { useWorkflowAgentSession } from "@/components/workflows/agent/use-workflow-agent-session"
import { setupMaiaMonaco, maiaMonacoOptions } from "@/lib/client/monaco"
import { StandardActionDialog } from "@/components/common/standard-action-dialog"
import { WorkflowQuickExamples } from "@/components/workflows/common/workflow-quick-examples"
import { MaiaMonacoEditor } from "@/components/common/maia-monaco-editor"
import { StandardPageHeader } from "@/components/common/standard-page-header"
import { DetailPageLayout } from "@/components/common/detail-page-layout"
import { useIsMobile } from "@/hooks/use-mobile"
import { toast } from "@/lib/client/toast"
import { HeaderActions } from "@/components/common/header-actions"
import { MessageParts } from "@/components/workflows/agent/message-parts"
import { ImagePreviewDialog, type ImagePreviewItem } from "@/components/workflows/agent/image-preview-dialog"
import { UserMessage } from "@/components/workflows/agent/user-message"
import { AVAILABLE_MODELS, groupModelsByProvider } from "@/lib/shared/models"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"
import { ChatHistorySheet, type ChatHistoryItem } from "@/components/workflows/agent/chat-history-sheet"
import { AgentMissingApiKeyAlert } from "@/components/agent/agent-missing-api-key-alert"

// ---------------------------------------------------------------------------
// Message rendering
// ---------------------------------------------------------------------------

type FileUIPart = Extract<UIMessage["parts"][number], { type: "file" }>
type UploadedChatImage = { url: string; mediaType: string; filename?: string }
type GraphStep = { stepKey: string; name: string; deps: string[] }
type OrchestratorProgress = {
  plan?: { title?: string | null; steps?: Array<{ name: string; description: string }> } | null
  draftStepsCount: number
  done: boolean
} | null

const GRAPH_CONTROLS = { interaction: false, layout: true, fit: true, zoom: true } as const
const CHAT_HISTORY_PAGE_SIZE = 20
type AgentSettingsResponse = {
  settings: { apiKeyConfigured: boolean; model: string }
}

async function uploadChatImages(params: {
  chatId: string
  files: File[]
  signal?: AbortSignal
}): Promise<UploadedChatImage[]> {
  const picked = (Array.isArray(params.files) ? params.files : []).filter((f) =>
    String(f.type || "")
      .toLowerCase()
      .startsWith("image/"),
  )
  if (!picked.length) return []
  const fd = new FormData()
  for (const f of picked) fd.append("files", f)
  const res = await fetch(`/api/chats/${encodeURIComponent(params.chatId)}/attachments`, {
    method: "POST",
    body: fd,
    signal: params.signal,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(typeof json?.code === "string" ? json.code : `HTTP ${res.status}`)
  }
  const returned: Array<{ url?: string; mediaType?: string; filename?: string }> = Array.isArray(json?.files)
    ? json.files
    : []
  const out: UploadedChatImage[] = []
  for (const r of returned) {
    const url = typeof r.url === "string" ? r.url : ""
    if (!url) continue
    out.push({
      url,
      mediaType: typeof r.mediaType === "string" && r.mediaType ? r.mediaType : "application/octet-stream",
      filename: typeof r.filename === "string" && r.filename ? r.filename : undefined,
    })
  }
  return out
}

const GraphCanvas = React.memo(function GraphCanvas(props: {
  workflowId?: string
  steps: GraphStep[]
  onEditStep: (stepKey: string) => void
  className?: string
}) {
  return (
    <WorkflowGraphCanvasWrapper
      mode="view"
      frame={false}
      workflowId={props.workflowId}
      forceAutoFit
      showLayoutMenu={!!props.workflowId}
      allowCustomLayout={!!props.workflowId}
      showLayoutReset={false}
      controls={GRAPH_CONTROLS}
      steps={props.steps}
      onEditStep={props.onEditStep}
      className={props.className}
    />
  )
})

const ChatMessageRow = React.memo(function ChatMessageRow(props: {
  message: UIMessage
  pending: boolean
  isStreaming?: boolean
  isLive?: boolean
  t: (k: string) => string
  model: string
  groupedModels: Array<{ provider: string; models: Array<{ id: string; name: string; provider: string }> }>
  onModelChange: (model: string) => void
  onOpenImagePreview: (item: ImagePreviewItem) => void
  orchestratorProgress: OrchestratorProgress
  onEditUserMessage: (
    messageId: string,
    text: string,
    files: FileUIPart[],
    removedFiles: FileUIPart[],
  ) => Promise<boolean>
  onPickImagesForEdit: (files: File[]) => Promise<FileUIPart[]>
  onToolApprovalResponse: (input: { id: string; approved: boolean; reason?: string }) => void
}) {
  const { message, t } = props
  const isUser = message.role === "user"

  if (!isUser) {
    return (
      <div>
        <MessageParts
          message={message}
          isStreaming={Boolean(props.isStreaming)}
          isLast={Boolean(props.isLive)}
          t={t}
          onToolApprovalResponse={props.onToolApprovalResponse}
          orchestratorProgress={props.isLive ? props.orchestratorProgress : null}
        />
      </div>
    )
  }

  return (
    <UserMessage
      message={message}
      t={t}
      pending={props.pending || Boolean(props.isStreaming)}
      model={props.model}
      groupedModels={props.groupedModels}
      onModelChange={props.onModelChange}
      onOpenImagePreview={props.onOpenImagePreview}
      onEditMessage={props.onEditUserMessage}
      onPickImages={props.onPickImagesForEdit}
    />
  )
})

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function WorkflowAgentClient(props: {
  chatId?: string | null
  workflowId?: string
  initialModel?: string
  initialMessages?: UIMessage[]
  initialPrompt?: string
  initialApiKeyConfigured?: boolean
}) {
  const { t, locale } = useI18n()
  const router = useRouter()
  const isMobile = useIsMobile()
  const workflowId = props.workflowId
  const [apiKeyConfigured, setApiKeyConfigured] = React.useState<boolean>(() =>
    typeof props.initialApiKeyConfigured === "boolean" ? props.initialApiKeyConfigured : false,
  )
  const session = useWorkflowAgentSession({
    chatId: props.chatId ?? null,
    workflowId,
    locale,
    t,
    initialPrompt: apiKeyConfigured ? props.initialPrompt : undefined,
    initialMessages: props.initialMessages,
    initialModel: props.initialModel,
  })
  const selectedStep = session.selectedStep
  const stepKeyInputId = React.useId()
  const stepNameInputId = React.useId()
  const stepTimeoutInputId = React.useId()
  const [newChatConfirmOpen, setNewChatConfirmOpen] = React.useState(false)
  const [chatHistoryOpen, setChatHistoryOpen] = React.useState(false)
  const [chatHistoryItems, setChatHistoryItems] = React.useState<ChatHistoryItem[]>([])
  const [chatHistoryLoading, setChatHistoryLoading] = React.useState(false)
  const [chatHistoryLoadingMore, setChatHistoryLoadingMore] = React.useState(false)
  const [chatHistoryOffset, setChatHistoryOffset] = React.useState(0)
  const [chatHistoryHasMore, setChatHistoryHasMore] = React.useState(true)
  const [mobileTab, setMobileTab] = React.useState<"chat" | "canvas">("chat")
  const [composerValue, setComposerValue] = React.useState("")
  const [modelsLoading, setModelsLoading] = React.useState(() => !String(props.initialModel ?? "").trim())

  const composerTextareaRef = React.useRef<HTMLTextAreaElement | null>(null)

  const groupedModels = React.useMemo(() => groupModelsByProvider(AVAILABLE_MODELS, session.model), [session.model])

  React.useEffect(() => {
    let cancelled = false
    const hasInitialModel = Boolean(String(props.initialModel ?? "").trim())
    async function loadAgentSettings() {
      try {
        const json = await apiFetchJson<AgentSettingsResponse>("/api/settings/agent", { method: "GET" })
        if (cancelled) return
        setApiKeyConfigured(Boolean(json?.settings?.apiKeyConfigured))
        const m = String(json?.settings?.model ?? "").trim()
        if (!hasInitialModel && m) session.setModel(m)
      } catch {
        // ignore – chat/session already has a fallback model
      } finally {
        if (!cancelled && !hasInitialModel) setModelsLoading(false)
      }
    }
    void loadAgentSettings()
    return () => {
      cancelled = true
    }
  }, [props.initialModel, session.setModel])

  type ComposerAttachment = {
    id: string
    filename: string
    mediaType: string
    previewUrl: string
    uploading: boolean
    uploadedUrl?: string
    error?: string
    abort?: AbortController
  }
  const [composerAttachments, setComposerAttachments] = React.useState<ComposerAttachment[]>([])
  const composerAttachmentsRef = React.useRef<ComposerAttachment[]>([])
  React.useEffect(() => {
    composerAttachmentsRef.current = composerAttachments
  }, [composerAttachments])

  React.useEffect(() => {
    return () => {
      for (const a of composerAttachmentsRef.current) {
        try {
          URL.revokeObjectURL(a.previewUrl)
        } catch {}
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const anyUploading = composerAttachments.some((a) => a.uploading)
  const anyFailed = composerAttachments.some((a) => a.error)

  const [imagePreview, setImagePreview] = React.useState<ImagePreviewItem | null>(null)
  const closePreview = React.useCallback(() => setImagePreview(null), [])
  const openPreviewSingle = React.useCallback((item: ImagePreviewItem) => setImagePreview(item), [])

  const onDownloadPreview = React.useCallback(() => {
    const it = imagePreview
    if (!it) return
    const a = document.createElement("a")
    a.href = it.src
    a.download = it.filename || "image"
    a.rel = "noreferrer"
    a.click()
  }, [imagePreview])

  const onOpenPreviewInNewTab = React.useCallback(() => {
    const it = imagePreview
    if (!it) return
    window.open(it.src, "_blank", "noreferrer")
  }, [imagePreview])

  const onCopyPreview = React.useCallback(async () => {
    const it = imagePreview
    if (!it) return

    // Prefer copying the image data when supported; fall back to copying the URL.
    try {
      const clipboard = navigator.clipboard as unknown as {
        write?: (items: unknown[]) => Promise<void>
        writeText?: (text: string) => Promise<void>
      }
      const hasClipboardItem =
        typeof (globalThis as unknown as { ClipboardItem?: unknown }).ClipboardItem !== "undefined"
      if (clipboard?.write && hasClipboardItem) {
        const res = await fetch(it.src)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        const type = blob.type || it.mediaType || "image/png"
        const ClipboardItemCtor = (
          globalThis as unknown as { ClipboardItem: new (data: Record<string, Blob>) => unknown }
        ).ClipboardItem
        await clipboard.write([new ClipboardItemCtor({ [type]: blob })])
        toast.success(t("common.copied"))
        return
      }
      if (clipboard?.writeText) {
        await clipboard.writeText(it.src)
        toast.success(t("common.copied"))
        return
      }
      throw new Error("Clipboard unavailable")
    } catch {
      toast.error(t("common.copyActionFailed"))
    }
  }, [imagePreview, t])

  const setComposerRef = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      composerTextareaRef.current = node
      ;(session.inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node
    },
    [session.inputRef],
  )

  const startNewChat = React.useCallback(() => router.push("/agent"), [router])
  const onNewChatClick = React.useCallback(() => {
    if (session.pending || session.saving) return
    if (session.isDirty) {
      setNewChatConfirmOpen(true)
      return
    }
    startNewChat()
  }, [session.pending, session.saving, session.isDirty, startNewChat])

  const loadChatHistory = React.useCallback(
    async (reset: boolean) => {
      if (reset) setChatHistoryLoading(true)
      else setChatHistoryLoadingMore(true)
      try {
        const offset = reset ? 0 : chatHistoryOffset
        const json = await apiFetchJson<{
          items?: Array<{
            id?: string
            publicId?: string
            title?: string
            createdAt?: string
            updatedAt?: string
          }>
          nextOffset?: number
          hasMore?: boolean
        }>(`/api/chats?limit=${CHAT_HISTORY_PAGE_SIZE}&offset=${offset}`, { cache: "no-store" })

        const incoming = (Array.isArray(json?.items) ? json.items : [])
          .map((it) => ({
            id: String(it?.id ?? ""),
            publicId: String(it?.publicId ?? ""),
            title: String(it?.title ?? ""),
            createdAt: String(it?.createdAt ?? ""),
            updatedAt: String(it?.updatedAt ?? ""),
          }))
          .filter((it) => it.id && it.publicId)

        setChatHistoryItems((prev) => (reset ? incoming : [...prev, ...incoming]))
        setChatHistoryOffset(
          typeof json?.nextOffset === "number" && Number.isFinite(json.nextOffset)
            ? json.nextOffset
            : offset + incoming.length,
        )
        setChatHistoryHasMore(Boolean(json?.hasMore))
      } catch (e) {
        toast.error(tApiError({ t, err: e, fallbackKey: "common.loadFailed" }))
      } finally {
        if (reset) setChatHistoryLoading(false)
        else setChatHistoryLoadingMore(false)
      }
    },
    [chatHistoryOffset, t],
  )

  const onOpenHistorySheet = React.useCallback(() => {
    setChatHistoryOpen(true)
    if (!chatHistoryItems.length && !chatHistoryLoading) {
      void loadChatHistory(true)
    }
  }, [chatHistoryItems.length, chatHistoryLoading, loadChatHistory])

  const onOpenHistoryChat = React.useCallback(
    (chatPublicId: string) => {
      setChatHistoryOpen(false)
      router.push(`/agent/${encodeURIComponent(chatPublicId)}`)
    },
    [router],
  )

  const onRenameHistoryChat = React.useCallback(async (chatId: string, title: string) => {
    await apiFetchJson(`/api/chats/${encodeURIComponent(chatId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    })
    setChatHistoryItems((prev) =>
      prev.map((it) => (it.id === chatId ? { ...it, title, updatedAt: new Date().toISOString() } : it)),
    )
  }, [])

  const onDeleteHistoryChat = React.useCallback(async (chatId: string) => {
    await apiFetchJson(`/api/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" })
    setChatHistoryItems((prev) => prev.filter((it) => it.id !== chatId))
    setChatHistoryOffset((prev) => Math.max(0, prev - 1))
  }, [])

  const onSend = React.useCallback(() => {
    const text = composerValue.trim()
    if (session.pending) return
    if (!apiKeyConfigured) {
      toast.error(t("errors.AGENT_API_KEY_MISSING"))
      return
    }
    if (anyUploading) {
      toast.error(t("workflows.orchestrator.attachments.uploadingToast"))
      return
    }
    if (anyFailed) {
      toast.error(t("workflows.orchestrator.attachments.removeFailedToast"))
      return
    }
    const files: FileUIPart[] = composerAttachments
      .map((a) =>
        a.uploadedUrl
          ? ({
              type: "file",
              url: a.uploadedUrl,
              mediaType: a.mediaType,
              filename: a.filename,
            } as FileUIPart)
          : null,
      )
      .filter((x): x is FileUIPart => Boolean(x))

    if (!text && files.length === 0) return
    session.send(text, files)
    setComposerValue("")
    setComposerAttachments((prev) => {
      for (const a of prev) {
        try {
          URL.revokeObjectURL(a.previewUrl)
        } catch {}
      }
      return []
    })
  }, [composerValue, session, composerAttachments, anyUploading, anyFailed, apiKeyConfigured, t])

  const uploadPickedImages = React.useCallback(
    async (files: File[]) => {
      const toAdd = (Array.isArray(files) ? files : []).filter((f) =>
        String(f.type || "")
          .toLowerCase()
          .startsWith("image/"),
      )
      if (!toAdd.length) return

      const abort = new AbortController()
      const newOnes: ComposerAttachment[] = toAdd.map((f) => ({
        id: crypto.randomUUID(),
        filename: f.name || t("workflows.orchestrator.attachments.fallbackImageName"),
        mediaType: f.type || "application/octet-stream",
        previewUrl: URL.createObjectURL(f),
        uploading: true,
        abort,
      }))

      setComposerAttachments((prev) => [...prev, ...newOnes])
      try {
        const returned = await uploadChatImages({ chatId: session.chatId, files: toAdd, signal: abort.signal })
        setComposerAttachments((prev) => {
          let i = 0
          return prev.map((a) => {
            const isNew = newOnes.some((n) => n.id === a.id)
            if (!isNew) return a
            const r = returned[i++] ?? null
            return {
              ...a,
              uploading: false,
              uploadedUrl: r?.url || undefined,
              mediaType: r?.mediaType || a.mediaType,
              filename: r?.filename || a.filename,
              error: r?.url ? undefined : (a.error ?? "UPLOAD_FAILED"),
            }
          })
        })
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          setComposerAttachments((prev) => prev.filter((a) => !newOnes.some((n) => n.id === a.id)))
          return
        }
        const msg = e instanceof Error ? e.message : String(e)
        setComposerAttachments((prev) =>
          prev.map((a) => (newOnes.some((n) => n.id === a.id) ? { ...a, uploading: false, error: msg } : a)),
        )
        toast.error(msg)
      }
    },
    [session.chatId, t],
  )

  const uploadPickedImagesForEdit = React.useCallback(
    async (files: File[]): Promise<FileUIPart[]> => {
      try {
        const returned = await uploadChatImages({ chatId: session.chatId, files })
        return returned.map((r) => {
          return {
            type: "file" as const,
            url: r.url,
            mediaType: r.mediaType,
            filename: r.filename,
          } as FileUIPart
        })
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
        return []
      }
    },
    [session.chatId],
  )

  const removeAttachment = React.useCallback(
    (id: string) => {
      let removedUploadedUrl = ""
      setComposerAttachments((prev) => {
        const item = prev.find((x) => x.id === id)
        if (item) {
          removedUploadedUrl = String(item.uploadedUrl || "").trim()
          try {
            item.abort?.abort()
          } catch {}
          try {
            URL.revokeObjectURL(item.previewUrl)
          } catch {}
        }
        return prev.filter((x) => x.id !== id)
      })
      if (!removedUploadedUrl) return
      // Fire-and-forget cleanup: never block user interactions on attachment deletion.
      void fetch(`/api/chats/${encodeURIComponent(session.chatId)}/attachments`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: [{ url: removedUploadedUrl }],
        }),
      }).catch(() => {})
    },
    [session.chatId],
  )

  const stepSheetContentRef = React.useRef<HTMLDivElement | null>(null)
  const title = workflowId ? t("workflows.orchestrator.titleEdit") : t("workflows.orchestrator.titleNew")
  const subtitle = workflowId ? t("workflows.orchestrator.subtitleEdit") : t("workflows.orchestrator.subtitleNew")
  const chatSpan = "row-span-5 lg:row-span-8"
  const composerSpan = "row-span-2"
  const graphSteps = React.useMemo(
    () => session.stepsForGraph.map((s) => ({ stepKey: s.stepKey, name: s.name, deps: s.deps })),
    [session.stepsForGraph],
  )
  const onEditGraphStep = React.useCallback(
    (stepKey: string) => {
      session.setSelectedStepKey(stepKey)
      session.setStepSheetOpen(true)
    },
    [session.setSelectedStepKey, session.setStepSheetOpen],
  )
  const onEditUserMessage = React.useCallback(
    async (messageId: string, text: string, files: FileUIPart[], removedFiles: FileUIPart[]) => {
      const ok = await session.editUserMessage(messageId, text, files)
      if (!ok) {
        toast.error(t("common.error"))
        return false
      }
      if (removedFiles.length > 0) {
        window.setTimeout(() => {
          void fetch(`/api/chats/${encodeURIComponent(session.chatId)}/attachments`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              files: removedFiles.map((f) => ({ url: String(f.url || "") })),
            }),
          }).catch(() => {})
        }, 800)
      }
      return ok
    },
    [session.chatId, session.editUserMessage, t],
  )

  // ---------------------------------------------------------------------------
  // Shared chat panel content
  // ---------------------------------------------------------------------------
  function renderChatContent() {
    return (
      <>
        {session.messages.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center p-6">
            <div className="w-full max-w-2xl">
              <div className="mb-5 flex flex-col items-center justify-center gap-3 text-center">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-foreground">
                  <Bot className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="text-lg font-semibold">{t("workflows.emptyTitle")}</div>
              </div>
              <WorkflowQuickExamples
                count={6}
                layout="wrap"
                behavior="fill"
                className="justify-center"
                onPick={(text) => {
                  setComposerValue(text)
                  requestAnimationFrame(() => composerTextareaRef.current?.focus())
                }}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {(() => {
              const allMessages = session.messages
              const streamingLast = session.pending ? allMessages[allMessages.length - 1] : null
              const historyMessages = streamingLast ? allMessages.slice(0, -1) : allMessages
              const orchestratorProgress = session.stageStatus.isOrchestrator
                ? {
                    plan: session.plan,
                    draftStepsCount: session.draftStepsFromStream.length,
                    done: session.stageStatus.validate === "done",
                  }
                : null

              type RenderItem = { msg: UIMessage; idx: number; opts?: { streaming?: boolean; live?: boolean } }
              const renderMessage = (item: RenderItem) => (
                <ChatMessageRow
                  key={item.msg.id || `msg-${item.idx}`}
                  message={item.msg}
                  pending={session.pending}
                  isStreaming={Boolean(item.opts?.streaming)}
                  isLive={Boolean(item.opts?.live)}
                  t={t}
                  model={session.model}
                  groupedModels={groupedModels}
                  onModelChange={session.setModel}
                  onOpenImagePreview={openPreviewSingle}
                  orchestratorProgress={orchestratorProgress}
                  onEditUserMessage={onEditUserMessage}
                  onPickImagesForEdit={uploadPickedImagesForEdit}
                  onToolApprovalResponse={session.addToolApprovalResponse}
                />
              )

              const historyVisible = historyMessages.filter((msg) => msg.role !== "system")
              const streamingVisible = streamingLast && streamingLast.role !== "system" ? streamingLast : null
              const items: RenderItem[] = [
                ...historyVisible.map((msg, idx) => ({ msg, idx })),
                ...(streamingVisible
                  ? [{ msg: streamingVisible, idx: historyVisible.length, opts: { streaming: true, live: true } }]
                  : []),
              ]

              type UserGroup = { user: RenderItem; rest: RenderItem[] }
              type GroupedEntry =
                | { kind: "single"; item: RenderItem }
                | { kind: "group"; group: UserGroup }
                | { kind: "non-user-block"; items: RenderItem[] }
              const grouped: GroupedEntry[] = []
              let currentGroup: UserGroup | null = null
              let leadingNonUser: RenderItem[] = []

              for (const item of items) {
                if (item.msg.role === "user") {
                  if (leadingNonUser.length > 0) {
                    grouped.push({ kind: "non-user-block", items: leadingNonUser })
                    leadingNonUser = []
                  }
                  if (currentGroup) grouped.push({ kind: "group", group: currentGroup })
                  currentGroup = { user: item, rest: [] }
                  continue
                }
                if (currentGroup) {
                  currentGroup.rest.push(item)
                } else {
                  leadingNonUser.push(item)
                }
              }
              if (leadingNonUser.length === 1) grouped.push({ kind: "single", item: leadingNonUser[0]! })
              if (leadingNonUser.length > 1) grouped.push({ kind: "non-user-block", items: leadingNonUser })
              if (currentGroup) grouped.push({ kind: "group", group: currentGroup })

              return (
                <>
                  {grouped.map((entry, i) => {
                    if (entry.kind === "single") return renderMessage(entry.item)
                    if (entry.kind === "non-user-block") {
                      return (
                        <div key={`non-user-block-${i}`} className="space-y-3">
                          {entry.items.map((item) => renderMessage(item))}
                        </div>
                      )
                    }
                    const { user, rest } = entry.group
                    return (
                      <div key={user.msg.id || `user-group-${i}`} className="space-y-3">
                        <div className="sticky top-0 z-10 bg-background">
                          <UserMessage
                            message={user.msg}
                            t={t}
                            pending={session.pending || Boolean(user.opts?.streaming)}
                            model={session.model}
                            groupedModels={groupedModels}
                            onModelChange={session.setModel}
                            onOpenImagePreview={openPreviewSingle}
                            onEditMessage={onEditUserMessage}
                            onPickImages={uploadPickedImagesForEdit}
                          />
                        </div>
                        {rest.map((item) => renderMessage(item))}
                      </div>
                    )
                  })}
                </>
              )
            })()}

            {/* Error display */}
            {session.error && (
              <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                {session.error.message}
              </div>
            )}

            <div ref={session.listRef} />
          </div>
        )}
      </>
    )
  }

  function renderComposer() {
    return (
      <PromptComposer
        t={t}
        value={composerValue}
        onValueChange={setComposerValue}
        textareaRef={setComposerRef}
        pending={session.pending}
        saving={session.saving}
        anyUploading={anyUploading}
        model={session.model}
        onModelChange={session.setModel}
        groupedModels={groupedModels}
        modelsLoading={modelsLoading}
        attachments={composerAttachments}
        onPickImages={uploadPickedImages}
        onRemoveAttachment={removeAttachment}
        onAttachmentClick={(a) => {
          openPreviewSingle({ src: a.previewUrl, filename: a.filename, mediaType: a.mediaType })
        }}
        mode="send-or-stop"
        pendingIndicator="square"
        onSubmit={onSend}
        onStop={session.stop}
        disableSubmitWhenIdle={!composerValue.trim() && composerAttachments.length === 0}
      />
    )
  }

  return (
    <DetailPageLayout
      variant="fill"
      modals={
        <>
          {imagePreview ? (
            <ImagePreviewDialog
              open={true}
              onOpenChange={(open) => {
                if (!open) closePreview()
              }}
              item={imagePreview}
              onDownload={onDownloadPreview}
              onCopy={onCopyPreview}
              onOpenInNewTab={onOpenPreviewInNewTab}
              t={t}
            />
          ) : null}
          <StandardActionDialog
            open={newChatConfirmOpen}
            onOpenChange={setNewChatConfirmOpen}
            title={t("common.unsavedChanges")}
            description={t("workflows.orchestrator.newChatUnsavedDescription")}
            pending={session.saving || session.pending}
            actions={[
              {
                key: "cancel",
                kind: "cancel",
                label: t("common.keepEditingAction"),
                icon: <Pencil className="h-4 w-4" />,
                disabled: session.saving || session.pending,
              },
              {
                key: "discard",
                label: t("common.discardAction"),
                icon: <Trash2Icon className="h-4 w-4" />,
                variant: "destructive",
                disabled: session.saving || session.pending,
                onClick: () => {
                  setNewChatConfirmOpen(false)
                  router.push("/agent")
                },
              },
              {
                key: "save",
                label: session.saving ? t("common.saving") : t("common.saveAction"),
                icon: session.saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />,
                disabled: session.saving || session.pending,
                onClick: async () => {
                  const ok = await session.saveFromCurrentState({ redirect: false })
                  if (!ok) return
                  setNewChatConfirmOpen(false)
                  router.push("/agent")
                },
              },
            ]}
          />
          <Sheet open={session.stepSheetOpen} onOpenChange={session.setStepSheetOpen}>
            <SheetContent
              side="right"
              className="w-full sm:max-w-2xl flex flex-col"
              ref={stepSheetContentRef}
              onOpenAutoFocus={(e) => {
                e.preventDefault()
                requestAnimationFrame(() => {
                  const root = stepSheetContentRef.current
                  if (!root) return
                  const first = root.querySelector(
                    "input:not([disabled]), textarea:not([disabled])",
                  ) as HTMLElement | null
                  first?.focus()
                })
              }}
            >
              <SheetHeader>
                <SheetTitle>
                  {selectedStep ? selectedStep.name : t("workflows.orchestrator.stepsRightTitle")}
                </SheetTitle>
                <SheetDescription className="sr-only">{t("workflows.orchestrator.stepSelectHint")}</SheetDescription>
              </SheetHeader>
              {!selectedStep ? (
                <div className="px-4 pt-4 text-sm text-muted-foreground">
                  {t("workflows.orchestrator.stepSelectHint")}
                </div>
              ) : (
                <div className="min-h-0 flex flex-1 flex-col gap-4 px-4 pb-4 pt-4">
                  <FieldGroup className="shrink-0 gap-3">
                    <Field className="gap-1">
                      <FieldLabel htmlFor={stepKeyInputId}>{t("workflows.stepKey")}</FieldLabel>
                      <Input
                        id={stepKeyInputId}
                        value={selectedStep.stepKey}
                        onChange={(e) => session.renameDraftStepKey(selectedStep.stepKey, e.target.value)}
                      />
                    </Field>
                    <Field className="gap-1">
                      <FieldLabel htmlFor={stepNameInputId}>{t("workflows.name")}</FieldLabel>
                      <Input
                        id={stepNameInputId}
                        value={selectedStep.name}
                        onChange={(e) => session.updateDraftStep(selectedStep.stepKey, { name: e.target.value })}
                      />
                    </Field>
                    <Field className="gap-1">
                      <FieldLabel htmlFor={stepTimeoutInputId}>{t("workflows.timeoutMs")}</FieldLabel>
                      <Input
                        id={stepTimeoutInputId}
                        type="number"
                        value={String(selectedStep.timeoutMs ?? "")}
                        onChange={(e) =>
                          session.updateDraftStep(selectedStep.stepKey, {
                            timeoutMs: Number(e.target.value) || selectedStep.timeoutMs,
                          })
                        }
                      />
                    </Field>
                  </FieldGroup>
                  <div className="min-h-0 flex flex-1 flex-col">
                    <SectionCard className="flex flex-col">
                      <div className="border-b bg-muted/10 px-3 py-2 text-sm font-medium">
                        {t("workflows.scriptEsm")}
                      </div>
                      <div className="min-h-0 flex-1">
                        <MaiaMonacoEditor
                          height="100%"
                          defaultLanguage="javascript"
                          theme={session.monacoTheme}
                          value={selectedStep.scriptEsm}
                          onChange={(v) => session.updateDraftStep(selectedStep.stepKey, { scriptEsm: v ?? "" })}
                          beforeMount={setupMaiaMonaco}
                          options={maiaMonacoOptions}
                        />
                      </div>
                      <div className="border-t bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
                        {t("workflows.engineRunsTipAgent")}
                      </div>
                    </SectionCard>
                  </div>
                </div>
              )}
            </SheetContent>
          </Sheet>
          <ChatHistorySheet
            open={chatHistoryOpen}
            onOpenChange={setChatHistoryOpen}
            locale={locale}
            items={chatHistoryItems}
            loading={chatHistoryLoading}
            hasMore={chatHistoryHasMore}
            loadingMore={chatHistoryLoadingMore}
            onLoadMore={() => loadChatHistory(false)}
            onOpenChat={onOpenHistoryChat}
            onRenameChat={onRenameHistoryChat}
            onDeleteChat={onDeleteHistoryChat}
          />
        </>
      }
      header={
        <StandardPageHeader
          title={title}
          description={subtitle}
          right={
            <HeaderActions
              iconOnlyBelow="md"
              overflow={false}
              overflowAlign="end"
              sections={[
                {
                  key: "main",
                  items: [
                    {
                      key: "new-chat",
                      label: t("agent.chat.newChat"),
                      icon: <Plus className="size-4" aria-hidden="true" />,
                      onClick: onNewChatClick,
                      pinned: true,
                      variant: "default",
                    },
                    {
                      key: "chat-history",
                      label: t("agent.chat.history.action"),
                      icon: <History className="size-4" aria-hidden="true" />,
                      onClick: onOpenHistorySheet,
                      pinned: true,
                      variant: "secondary",
                    },
                  ],
                },
              ]}
            />
          }
        />
      }
      bodyClassName="min-h-0 flex-1 overflow-hidden"
    >
      <div className="min-h-0 flex-1 overflow-hidden">
        {isMobile ? (
          <Tabs
            value={mobileTab}
            onValueChange={(v) => setMobileTab(v as "chat" | "canvas")}
            className="flex h-full min-h-0 flex-col gap-3"
          >
            <div className="shrink-0">
              <TabsList className="w-full">
                <TabsTrigger value="chat" className="flex-1">
                  {t("common.tabs.chat")}
                </TabsTrigger>
                <TabsTrigger value="canvas" className="flex-1">
                  {t("common.tabs.editor")}
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="chat" className="min-h-0 flex-1">
              <div className="grid h-full min-h-0 grid-rows-7 gap-3">
                <Card className={cn("min-h-0 overflow-hidden p-0 shadow-none rounded-md", chatSpan)}>
                  <div className="flex h-full min-h-0 flex-col" ref={session.scrollContainerRef}>
                    <ScrollArea className="relative h-full min-h-0 flex-1 bg-background p-3 [&_[data-slot=scroll-area-viewport]>div]:!block">
                      {renderChatContent()}
                    </ScrollArea>
                    {!apiKeyConfigured ? (
                      <div className="shrink-0 border-t p-3">
                        <AgentMissingApiKeyAlert />
                      </div>
                    ) : null}
                  </div>
                </Card>
                <Card className={cn("min-h-0 overflow-hidden p-0 shadow-none rounded-md", composerSpan)}>
                  {renderComposer()}
                </Card>
              </div>
            </TabsContent>
            <TabsContent value="canvas" className="min-h-0 flex-1">
              <SectionCard className="h-full min-h-0 overflow-hidden text-card-foreground">
                <div className="relative h-full">
                  <GraphCanvas
                    workflowId={workflowId}
                    steps={graphSteps}
                    onEditStep={onEditGraphStep}
                    className="h-full"
                  />
                </div>
              </SectionCard>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="grid h-full min-h-0 grid-rows-10 gap-3 lg:grid-cols-12 xl:grid-cols-10 lg:grid-rows-1">
            <SectionCard className="min-h-0 row-span-3 text-card-foreground lg:col-span-7 xl:col-span-7 lg:row-span-1">
              <div className="relative h-full">
                <GraphCanvas
                  workflowId={workflowId}
                  steps={graphSteps}
                  onEditStep={onEditGraphStep}
                  className="h-full"
                />
              </div>
            </SectionCard>
            <div className="min-h-0 row-span-7 grid grid-rows-7 gap-3 lg:col-span-5 xl:col-span-3 lg:row-span-1 lg:grid-rows-10">
              <Card className={cn("min-h-0 overflow-hidden p-0 shadow-none rounded-md", chatSpan)}>
                <div className="flex h-full min-h-0 flex-col" ref={session.scrollContainerRef}>
                  <ScrollArea className="relative h-full min-h-0 flex-1 bg-background p-3 [&_[data-slot=scroll-area-viewport]>div]:!block">
                    {renderChatContent()}
                  </ScrollArea>
                  {!apiKeyConfigured ? (
                    <div className="shrink-0 border-t p-3">
                      <AgentMissingApiKeyAlert />
                    </div>
                  ) : null}
                </div>
              </Card>
              <Card className={cn("min-h-0 overflow-hidden p-0 shadow-none rounded-md", composerSpan)}>
                {renderComposer()}
              </Card>
            </div>
          </div>
        )}
      </div>
    </DetailPageLayout>
  )
}
