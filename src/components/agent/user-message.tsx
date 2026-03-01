"use client"

import * as React from "react"
import { ArrowUp, FileText } from "lucide-react"
import type { UIMessage } from "ai"

import { AttachmentThumbImage, PromptComposer, type PromptComposerAttachment } from "@/components/agent/prompt-composer"
import { Button } from "@/components/ui/button"
import type { ImagePreviewItem } from "@/components/agent/image-preview-dialog"
import { Spinner } from "@/components/ui/spinner"
import type { PromptComposerModelGroup } from "@/components/agent/prompt-composer"
import { cn } from "@/lib/utils"
import type { AgentMode } from "@/lib/shared/agent/modes"
import { randomUUID } from "@/lib/shared/crypto/random-uuid"

type UserMessageProps = {
  message: UIMessage
  t: (k: string) => string
  pending: boolean
  model: string
  groupedModels: PromptComposerModelGroup[]
  onModelChange: (model: string) => void
  onOpenImagePreview: (item: ImagePreviewItem) => void
  onEditMessage: (
    messageId: string,
    text: string,
    files: Array<Extract<UIMessage["parts"][number], { type: "file" }>>,
    removedFiles: Array<Extract<UIMessage["parts"][number], { type: "file" }>>,
  ) => Promise<boolean>
  onPickImages?: (files: File[]) => Promise<Array<Extract<UIMessage["parts"][number], { type: "file" }>>>
  agentMode?: AgentMode
  onAgentModeChange?: (mode: AgentMode) => void
}

type FileUIPart = Extract<UIMessage["parts"][number], { type: "file" }>

type ReadonlyUserMessageProps = {
  attachments: PromptComposerAttachment[]
  draft: string
  text: string
  t: (k: string) => string
  onFocus: () => void
  onOpenAttachment: (url: string, filename: string, mediaType: string) => void
}

function ReadonlyUserMessage(props: ReadonlyUserMessageProps) {
  const imageAttachments = props.attachments.filter((a) =>
    String(a.mediaType || "")
      .toLowerCase()
      .startsWith("image/"),
  )
  const fileAttachments = props.attachments.filter(
    (a) =>
      !String(a.mediaType || "")
        .toLowerCase()
        .startsWith("image/"),
  )

  const textRef = React.useRef<HTMLDivElement | null>(null)

  return (
    <div
      className="relative rounded-md bg-accent/50"
      role="button"
      tabIndex={0}
      onClick={props.onFocus}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return
        e.preventDefault()
        props.onFocus()
      }}
    >
      {props.attachments.length > 0 ? (
        <div className="w-full shrink-0 p-2 pb-0">
          {imageAttachments.length > 0 ? (
            <div className="u-scrollbar-hidden flex max-w-full gap-2 overflow-x-auto">
              {imageAttachments.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="group relative h-10 w-10 shrink-0 overflow-hidden rounded-md border bg-background cursor-zoom-in"
                  title={a.filename}
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onOpenAttachment(a.previewUrl, a.filename, a.mediaType)
                  }}
                  aria-label={props.t("common.openAction")}
                >
                  <div className="pointer-events-none relative h-10 w-10">
                    <AttachmentThumbImage src={a.previewUrl} alt={a.filename} />
                  </div>
                </button>
              ))}
            </div>
          ) : null}
          {fileAttachments.length > 0 ? (
            <div
              className={cn(
                "u-scrollbar-hidden flex max-w-full gap-2 overflow-x-auto",
                imageAttachments.length > 0 ? "mt-2" : "",
              )}
            >
              {fileAttachments.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="group relative h-7 w-40 shrink-0 overflow-hidden rounded-md border bg-background cursor-pointer text-left"
                  title={a.filename}
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onOpenAttachment(a.previewUrl, a.filename, a.mediaType)
                  }}
                  aria-label={props.t("common.openAction")}
                >
                  <div className="flex h-full items-center gap-1.5 px-2 text-xs text-muted-foreground">
                    <FileText className="size-3.5 shrink-0 text-foreground/70" />
                    <span className="truncate">{a.filename}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        ref={textRef}
        className="min-h-11 max-h-[8vh] overflow-hidden whitespace-pre-wrap break-all px-3 py-3 text-base md:text-sm"
      >
        {props.draft || props.text || " "}
      </div>
    </div>
  )
}

function normalizeChatAttachmentUrl(rawUrl: string): string {
  const raw = String(rawUrl || "").trim()
  if (!raw) return ""
  if (/^\/api\/chats\/[^/]+\/attachments\/[a-f0-9]{64}/i.test(raw)) return raw
  if (typeof window === "undefined") return raw
  try {
    const u = new URL(raw, window.location.origin)
    if (!/^\/api\/chats\/[^/]+\/attachments\/[a-f0-9]{64}/i.test(u.pathname)) return raw
    return `${u.pathname}${u.search}`
  } catch {
    return raw
  }
}

function downloadAttachment(url: string, filename: string) {
  const link = document.createElement("a")
  link.href = url
  link.download = filename || "file"
  link.rel = "noreferrer"
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function shouldKeepEditingOnBlur(next: Node | null): boolean {
  if (!next) return false
  if (!(next instanceof HTMLElement)) return false
  if (next.closest("[data-slot='select-content']")) return true
  if (next.closest("[data-slot='select-trigger']")) return true
  if (next.closest("[data-radix-popper-content-wrapper]")) return true
  if (next.closest("[role='listbox']")) return true
  return false
}

export function UserMessage(props: UserMessageProps) {
  const files = React.useMemo(
    () =>
      props.message.parts.filter((p): p is Extract<UIMessage["parts"][number], { type: "file" }> => p.type === "file"),
    [props.message.parts],
  )
  const text = React.useMemo(
    () =>
      props.message.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(""),
    [props.message.parts],
  )
  const [draft, setDraft] = React.useState(text)
  const [draftFiles, setDraftFiles] = React.useState<Array<FileUIPart & { _editId: string }>>(() =>
    files.map((file, i) => ({
      ...file,
      url: normalizeChatAttachmentUrl(file.url),
      _editId: `${props.message.id}-file-${i}`,
    })),
  )
  const [saving, setSaving] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [focused, setFocused] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)

  React.useEffect(() => {
    if (focused) return
    setDraft(text)
    setDraftFiles(
      files.map((file, i) => ({
        ...file,
        url: normalizeChatAttachmentUrl(file.url),
        _editId: `${props.message.id}-file-${i}`,
      })),
    )
  }, [text, files, focused, props.message.id])

  const attachments = React.useMemo<PromptComposerAttachment[]>(
    () =>
      draftFiles.map((file) => ({
        id: file._editId,
        filename:
          file.filename ??
          (String(file.mediaType || "")
            .toLowerCase()
            .startsWith("image/")
            ? props.t("workflows.orchestrator.attachments.fallbackImageName")
            : props.t("workflows.orchestrator.attachments.fallbackFileName")),
        mediaType: String(file.mediaType || "application/octet-stream"),
        previewUrl: normalizeChatAttachmentUrl(file.url),
        uploading: false,
      })),
    [draftFiles, props.t],
  )
  const originalSignature = React.useMemo(
    () =>
      JSON.stringify(
        files.map((f) => ({
          url: normalizeChatAttachmentUrl(f.url),
          mediaType: String(f.mediaType || "application/octet-stream"),
          filename: typeof f.filename === "string" ? f.filename : "",
        })),
      ),
    [files],
  )
  const draftSignature = React.useMemo(
    () =>
      JSON.stringify(
        draftFiles.map((f) => ({
          url: normalizeChatAttachmentUrl(f.url),
          mediaType: String(f.mediaType || "application/octet-stream"),
          filename: typeof f.filename === "string" ? f.filename : "",
        })),
      ),
    [draftFiles],
  )
  const dirty = draft !== text || originalSignature !== draftSignature
  const hasContent = draft.trim().length > 0 || draftFiles.length > 0

  const openAttachment = React.useCallback(
    (url: string, filename: string, mediaType: string) => {
      const normalized = normalizeChatAttachmentUrl(url)
      if (
        !String(mediaType || "")
          .toLowerCase()
          .startsWith("image/")
      ) {
        downloadAttachment(normalized, filename)
        return
      }
      props.onOpenImagePreview({
        src: normalized,
        filename,
        mediaType,
      })
    },
    [props.onOpenImagePreview],
  )

  React.useEffect(() => {
    if (!focused) return
    const raf = window.requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      const len = el.value.length
      el.setSelectionRange(len, len)
    })
    return () => window.cancelAnimationFrame(raf)
  }, [focused])

  const onCancel = React.useCallback(() => {
    setDraft(text)
    setDraftFiles(
      files.map((file, i) => ({
        ...file,
        url: normalizeChatAttachmentUrl(file.url),
        _editId: `${props.message.id}-file-${i}`,
      })),
    )
    setFocused(false)
    const root = rootRef.current
    if (root && root.contains(document.activeElement)) {
      ;(document.activeElement as HTMLElement | null)?.blur()
    }
  }, [text, files, props.message.id])

  React.useEffect(() => {
    if (!focused) return
    const root = rootRef.current

    const onPointerDown = (e: PointerEvent) => {
      if (!root) return
      if (e.target instanceof Node && root.contains(e.target)) return
      if (e.target instanceof HTMLElement && shouldKeepEditingOnBlur(e.target)) return
      onCancel()
    }

    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null
      if (next && root?.contains(next)) return
      if (shouldKeepEditingOnBlur(next)) return
      onCancel()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (e.isComposing) return
      onCancel()
    }

    window.addEventListener("pointerdown", onPointerDown)
    root?.addEventListener("focusout", onFocusOut)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("pointerdown", onPointerDown)
      root?.removeEventListener("focusout", onFocusOut)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [focused, onCancel])

  const onSave = React.useCallback(async () => {
    if (!hasContent) return
    if (saving) return
    if (uploading) return
    setSaving(true)
    const nextFiles = draftFiles.map((f) => ({
      type: "file" as const,
      url: normalizeChatAttachmentUrl(f.url),
      mediaType: String(f.mediaType || "application/octet-stream"),
      filename: typeof f.filename === "string" ? f.filename : undefined,
    }))
    const nextUrls = new Set(nextFiles.map((f) => f.url))
    const removedFiles = files
      .map((f) => ({
        type: "file" as const,
        url: normalizeChatAttachmentUrl(f.url),
        mediaType: String(f.mediaType || "application/octet-stream"),
        filename: typeof f.filename === "string" ? f.filename : undefined,
      }))
      .filter((f) => !nextUrls.has(f.url))
    try {
      const ok = await props.onEditMessage(props.message.id, draft, nextFiles, removedFiles)
      if (!ok) return
      setFocused(false)
      const root = rootRef.current
      if (root && root.contains(document.activeElement)) {
        ;(document.activeElement as HTMLElement | null)?.blur()
      }
    } finally {
      setSaving(false)
    }
  }, [hasContent, saving, uploading, props, draft, draftFiles, files])

  const onPickImages = React.useCallback(
    async (picked: File[]) => {
      if (!props.onPickImages) return
      setUploading(true)
      try {
        const uploaded = await props.onPickImages(picked)
        if (!uploaded.length) return
        setDraftFiles((prev) => [
          ...prev,
          ...uploaded.map((f, i) => ({
            ...f,
            url: normalizeChatAttachmentUrl(String(f.url || "")),
            _editId: `${props.message.id}-picked-${Date.now()}-${i}-${randomUUID()}`,
          })),
        ])
      } finally {
        setUploading(false)
      }
    },
    [props.onPickImages, props.message.id],
  )

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-md border transition-[border-color,box-shadow]",
        focused ? "shadow-xs" : "",
      )}
      ref={rootRef}
    >
      {focused ? (
        <PromptComposer
          t={props.t}
          value={draft}
          onValueChange={setDraft}
          textareaRef={textareaRef}
          pending={props.pending || saving}
          saving={saving}
          anyUploading={uploading}
          model={props.model}
          onModelChange={props.onModelChange}
          groupedModels={props.groupedModels}
          attachments={attachments}
          onPickImages={onPickImages}
          onAttachmentClick={(a) => openAttachment(a.previewUrl, a.filename, a.mediaType)}
          agentMode={props.agentMode}
          onAgentModeChange={props.onAgentModeChange}
          variant="chat"
          chrome="message-edit"
          textareaMaxHeight="20vh"
          containerClassName="rounded-md bg-accent/50"
          inputGroupClassName="rounded-md"
          messageEditShowLeftControls={true}
          messageEditActions={
            <Button
              type="button"
              size="icon"
              variant="default"
              className="size-7 rounded-full"
              onClick={() => void onSave()}
              disabled={!hasContent || saving || uploading || props.pending}
              aria-label={props.t("workflows.orchestrator.sendAction")}
            >
              {saving ? <Spinner className="size-5" /> : <ArrowUp className="size-5" />}
            </Button>
          }
          attachmentRemovable={true}
          onRemoveAttachment={(id) => {
            setDraftFiles((prev) => prev.filter((f) => f._editId !== id))
          }}
          mode="send-only"
          onSubmit={() => void onSave()}
          disableSubmitWhenIdle={!hasContent}
        />
      ) : (
        <ReadonlyUserMessage
          attachments={attachments}
          draft={draft}
          text={text}
          t={props.t}
          onFocus={() => setFocused(true)}
          onOpenAttachment={openAttachment}
        />
      )}
    </div>
  )
}
