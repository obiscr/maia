"use client"

import * as React from "react"
import { Bot } from "lucide-react"

import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { AgentQuickExamples } from "@/components/workflows/common/workflow-quick-examples"
import type { TFunction } from "@/lib/shared/i18n/t"
import { cn } from "@/lib/utils"
import { ImagePreviewDialog, type ImagePreviewItem } from "@/components/workflows/agent/image-preview-dialog"
import { toast } from "@/lib/client/toast"
import {
  PromptComposer,
  type PromptComposerAttachment,
  type PromptComposerModelGroup,
} from "@/components/agent/prompt-composer"
import { AgentMissingApiKeyAlert } from "@/components/agent/agent-missing-api-key-alert"
import type { AgentMode } from "@/lib/shared/agent/modes"

export function AgentWelcomeEmpty(props: {
  t: TFunction
  prompt: string
  setPrompt: (next: string) => void
  promptRef: React.RefObject<HTMLTextAreaElement | null>
  onSubmit: () => void
  pending?: boolean
  /** When false, avoids using viewport-based min-height (useful inside dialogs). */
  fullHeight?: boolean
  apiKeyConfigured?: boolean | null

  model: string
  setModel: (m: string) => void
  groupedModels: PromptComposerModelGroup[]
  settingsLoading?: boolean

  attachments: Array<PromptComposerAttachment & { uploadedUrl?: string }>
  removeAttachment: (id: string) => void
  uploadPickedImages: (files: File[]) => void | Promise<void>
  anyUploading?: boolean

  agentMode?: AgentMode
  onAgentModeChange?: (mode: AgentMode) => void
}) {
  const {
    t,
    prompt,
    setPrompt,
    promptRef,
    onSubmit,
    pending = false,
    fullHeight = true,
    apiKeyConfigured = null,
    model,
    setModel,
    groupedModels,
    settingsLoading = false,
    attachments,
    removeAttachment,
    uploadPickedImages,
    anyUploading = false,
  } = props

  const hasSendableAttachments = attachments.some((a) => Boolean(a.uploadedUrl))
  const sendDisabled = !prompt.trim() && !hasSendableAttachments

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

  return (
    <div className={cn(fullHeight ? "min-h-[calc(100vh-260px)]" : "min-h-0 py-10", "flex justify-center")}>
      <div className="w-full max-w-3xl px-3 my-auto">
        <Empty className="w-full border-0 p-0 md:p-0">
          <div className="w-full p-2 pb-6 md:p-4 space-y-6 text-left">
            <EmptyHeader className="mx-auto">
              <EmptyMedia variant="icon">
                <Bot className="h-5 w-5" aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{t("workflows.emptyTitle")}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent className="mx-auto max-w-2xl text-wrap">
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

              {apiKeyConfigured === false ? <AgentMissingApiKeyAlert className="mb-3" /> : null}

              <PromptComposer
                t={t}
                value={prompt}
                onValueChange={setPrompt}
                textareaRef={promptRef}
                pending={pending}
                anyUploading={anyUploading}
                model={model}
                onModelChange={setModel}
                groupedModels={groupedModels}
                settingsLoading={settingsLoading}
                attachments={attachments}
                onPickImages={uploadPickedImages}
                onRemoveAttachment={removeAttachment}
                agentMode={props.agentMode}
                onAgentModeChange={props.onAgentModeChange}
                variant="landing"
                onAttachmentClick={(a) => {
                  const att = attachments.find((x) => x.id === a.id)
                  openPreviewSingle({
                    src: att?.uploadedUrl || a.previewUrl,
                    filename: a.filename || t("workflows.orchestrator.attachments.fallbackImageName"),
                    mediaType: a.mediaType,
                  })
                }}
                mode="send-only"
                pendingIndicator="spinner"
                onSubmit={onSubmit}
                disableSubmitWhenIdle={sendDisabled}
              />
            </EmptyContent>

            <AgentQuickExamples
              templateCount={2}
              behavior="fill"
              onPick={(text) => {
                setPrompt(text)
                requestAnimationFrame(() => promptRef.current?.focus())
              }}
            />
          </div>
        </Empty>
      </div>
    </div>
  )
}
