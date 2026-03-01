"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import type { UIMessage } from "ai"

import { useI18n } from "@/components/i18n-provider"
import { AgentWelcomeEmpty } from "@/components/agent/agent-welcome-empty"
import { apiFetchJson } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"
import { AVAILABLE_MODELS, DEFAULT_CHAT_MODEL, groupModelsByProvider } from "@/lib/shared/models"
import { useWorkflowAgentSession } from "@/components/workflows/agent/use-workflow-agent-session"
import { type AgentMode, isAgentMode } from "@/lib/shared/agent/modes"
import { randomUUID } from "@/lib/shared/crypto/random-uuid"

type AgentSettingsResponse = {
  settings: { apiKeyConfigured: boolean; model: string; mode?: string }
}

export function AgentLandingPage(props: { initialApiKeyConfigured?: boolean }) {
  const { t, locale } = useI18n()
  const router = useRouter()
  const sp = useSearchParams()
  const [prompt, setPrompt] = React.useState("")
  const promptRef = React.useRef<HTMLTextAreaElement | null>(null)

  const didAutoRunRef = React.useRef(false)
  const startingRef = React.useRef(false)
  const [starting, setStarting] = React.useState(false)
  const [settingsLoading, setModelsLoading] = React.useState(true)
  const [apiKeyConfigured, setApiKeyConfigured] = React.useState<boolean | null>(() =>
    typeof props.initialApiKeyConfigured === "boolean" ? props.initialApiKeyConfigured : null,
  )
  const session = useWorkflowAgentSession({
    chatId: null,
    locale,
    t,
    initialModel: DEFAULT_CHAT_MODEL,
  })
  const chatId = session.chatId
  const pending = session.pending
  const model = session.model
  const setSessionModel = session.setModel
  const setSessionMode = session.setMode

  React.useEffect(() => {
    let cancelled = false
    async function loadAgentSettings() {
      try {
        const json = await apiFetchJson<AgentSettingsResponse>("/api/settings/agent", { method: "GET" })
        if (cancelled) return
        setApiKeyConfigured(Boolean(json?.settings?.apiKeyConfigured))
        const m = String(json?.settings?.model ?? "").trim()
        if (m) setSessionModel(m)
        const rawMode = json?.settings?.mode
        if (typeof rawMode === "string" && isAgentMode(rawMode)) setSessionMode(rawMode)
      } catch {
        // ignore – default model is already set
      } finally {
        if (!cancelled) setModelsLoading(false)
      }
    }
    void loadAgentSettings()
    return () => {
      cancelled = true
    }
  }, [setSessionModel, setSessionMode])

  const setModel = React.useCallback(
    (next: string) => {
      setSessionModel(next)
      apiFetchJson("/api/settings/agent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: next }),
      }).catch(() => {})
    },
    [setSessionModel],
  )

  const setMode = React.useCallback(
    (next: AgentMode) => {
      setSessionMode(next)
      apiFetchJson("/api/settings/agent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      }).catch(() => {})
    },
    [setSessionMode],
  )

  const groupedModels = React.useMemo(() => groupModelsByProvider(AVAILABLE_MODELS, model), [model])

  type LandingAttachment = {
    id: string
    filename: string
    mediaType: string
    previewUrl: string
    uploading: boolean
    uploadedUrl?: string
    error?: string
    abort?: AbortController
  }

  const [attachments, setAttachments] = React.useState<LandingAttachment[]>([])
  const attachmentsRef = React.useRef<LandingAttachment[]>([])
  React.useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  React.useEffect(() => {
    return () => {
      for (const a of attachmentsRef.current) {
        try {
          URL.revokeObjectURL(a.previewUrl)
        } catch {}
      }
    }
  }, [])

  const anyUploading = attachments.some((a) => a.uploading)
  const anyFailed = attachments.some((a) => a.error)

  const uploadPickedImages = React.useCallback(
    async (files: File[]) => {
      const picked = (Array.isArray(files) ? files : []).filter((f) =>
        String(f.type || "")
          .toLowerCase()
          .startsWith("image/"),
      )
      if (!picked.length) return

      const abort = new AbortController()
      const newOnes: LandingAttachment[] = picked.map((f) => ({
        id: randomUUID(),
        filename: f.name || t("workflows.orchestrator.attachments.fallbackImageName"),
        mediaType: f.type || "application/octet-stream",
        previewUrl: URL.createObjectURL(f),
        uploading: true,
        abort,
      }))

      setAttachments((prev) => [...prev, ...newOnes])

      const fd = new FormData()
      for (const f of picked) fd.append("files", f)

      let json: any
      try {
        const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/attachments`, {
          method: "POST",
          body: fd,
          signal: abort.signal,
        })
        json = await res.json().catch(() => null)
        if (!res.ok) {
          throw new Error(typeof json?.code === "string" ? json.code : `HTTP ${res.status}`)
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          setAttachments((prev) => prev.filter((a) => !newOnes.some((n) => n.id === a.id)))
          return
        }
        const msg = e instanceof Error ? e.message : String(e)
        setAttachments((prev) =>
          prev.map((a) => (newOnes.some((n) => n.id === a.id) ? { ...a, uploading: false, error: msg } : a)),
        )
        toast.error(msg)
        return
      }

      const returned: Array<{ url?: string; mediaType?: string; filename?: string }> = Array.isArray(json?.files)
        ? json.files
        : []
      setAttachments((prev) => {
        let i = 0
        return prev.map((a) => {
          const isNew = newOnes.some((n) => n.id === a.id)
          if (!isNew) return a
          const r = returned[i++] ?? {}
          const url = typeof r.url === "string" ? r.url : ""
          return {
            ...a,
            uploading: false,
            uploadedUrl: url || undefined,
            mediaType: typeof r.mediaType === "string" && r.mediaType ? r.mediaType : a.mediaType,
            filename: typeof r.filename === "string" && r.filename ? r.filename : a.filename,
            error: url ? undefined : (a.error ?? "UPLOAD_FAILED"),
          }
        })
      })
    },
    [t, chatId],
  )

  const removeAttachment = React.useCallback(
    (id: string) => {
      let removedUploadedUrl = ""
      setAttachments((prev) => {
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
      void fetch(`/api/chats/${encodeURIComponent(chatId)}/attachments`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: [{ url: removedUploadedUrl }],
        }),
      }).catch(() => {})
    },
    [chatId],
  )

  type FileUIPart = Extract<UIMessage["parts"][number], { type: "file" }>

  const startViaDetailsPage = React.useCallback(
    async (text: string, files: FileUIPart[]) => {
      const clean = String(text ?? "").trim()
      const fs = Array.isArray(files) ? files : []
      if ((!clean && fs.length === 0) || pending || startingRef.current) return
      startingRef.current = true
      setStarting(true)
      try {
        const res = await apiFetchJson<{ id?: string; publicId?: string }>("/api/chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, model, agentMode: session.mode }),
        })
        const publicId = typeof res?.publicId === "string" ? res.publicId : ""
        if (!publicId) return
        await apiFetchJson(`/api/chats/${encodeURIComponent(chatId)}/initial-send`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: clean,
            files: fs.map((f) => ({ url: f.url, mediaType: f.mediaType, filename: f.filename })),
          }),
        })
        router.push(`/agent/${encodeURIComponent(publicId)}`)
      } finally {
        startingRef.current = false
        setStarting(false)
      }
    },
    [pending, chatId, model, session.mode, router],
  )

  const onSubmit = React.useCallback(async () => {
    const text = prompt.trim()
    if (pending || startingRef.current) return
    if (apiKeyConfigured === false) {
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

    const files: FileUIPart[] = attachments
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
    didAutoRunRef.current = true
    await startViaDetailsPage(text, files)
    setPrompt("")
    setAttachments((prev) => {
      for (const a of prev) {
        try {
          URL.revokeObjectURL(a.previewUrl)
        } catch {}
      }
      return []
    })
  }, [pending, prompt, apiKeyConfigured, anyUploading, anyFailed, attachments, t, startViaDetailsPage])

  React.useEffect(() => {
    if (didAutoRunRef.current) return
    if (pending || startingRef.current) return
    if (apiKeyConfigured === null) return
    const promptFromUrl = (sp.get("prompt") ?? "").trim()
    if (!promptFromUrl) return
    didAutoRunRef.current = true
    setPrompt(promptFromUrl)
    if (apiKeyConfigured) void startViaDetailsPage(promptFromUrl, [])
  }, [pending, apiKeyConfigured, startViaDetailsPage, sp])

  return (
    <AgentWelcomeEmpty
      t={t}
      prompt={prompt}
      setPrompt={setPrompt}
      promptRef={promptRef}
      onSubmit={onSubmit}
      pending={pending || starting}
      apiKeyConfigured={apiKeyConfigured}
      model={model}
      setModel={setModel}
      groupedModels={groupedModels}
      settingsLoading={settingsLoading}
      attachments={attachments}
      removeAttachment={removeAttachment}
      uploadPickedImages={uploadPickedImages}
      anyUploading={anyUploading}
      agentMode={session.mode}
      onAgentModeChange={setMode}
    />
  )
}
