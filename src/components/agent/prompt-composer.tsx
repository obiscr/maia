"use client"

import * as React from "react"
import { ArrowUp, Download, FileText, Plus, Square, X } from "lucide-react"

import { Spinner } from "@/components/ui/spinner"
import { Skeleton } from "@/components/ui/skeleton"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

const loadedAttachmentThumbSrcCache = new Set<string>()

export type PromptComposerAttachment = {
  id: string
  filename: string
  mediaType: string
  previewUrl: string
  uploading: boolean
  error?: string
}

export type PromptComposerModelGroup = {
  provider: string
  models: Array<{ id: string; name: string; provider: string }>
}

export function AttachmentThumbImage(props: { src: string; alt: string; uploading?: boolean; dimmed?: boolean }) {
  const src = String(props.src || "")
  const alt = String(props.alt || "")
  const uploading = props.uploading === true
  const dimmed = props.dimmed === true

  const [loaded, setLoaded] = React.useState(() => loadedAttachmentThumbSrcCache.has(src))
  const [errored, setErrored] = React.useState(false)
  const [showSpinner, setShowSpinner] = React.useState(false)

  React.useEffect(() => {
    setLoaded(loadedAttachmentThumbSrcCache.has(src))
    setErrored(false)
    setShowSpinner(false)
  }, [src])

  React.useEffect(() => {
    if (uploading) {
      setShowSpinner(true)
      return
    }
    if (loaded || errored) {
      setShowSpinner(false)
      return
    }
    const t = setTimeout(() => setShowSpinner(true), 150)
    return () => clearTimeout(t)
  }, [uploading, loaded, errored])

  const showLoading = !loaded && !errored

  return (
    <>
      {showLoading ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 bg-muted/25",
            "animate-pulse",
            uploading ? "opacity-70" : "",
          )}
        />
      ) : null}
      {showSpinner ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-background/30">
          <Spinner className="h-4 w-4 text-foreground" />
        </div>
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="eager"
        decoding="sync"
        className={cn(
          "pointer-events-none h-full w-full object-cover transition-opacity",
          loaded ? "opacity-100" : "opacity-0",
          dimmed ? "opacity-60" : "",
        )}
        onLoad={() => {
          loadedAttachmentThumbSrcCache.add(src)
          setLoaded(true)
        }}
        onError={() => setErrored(true)}
      />
    </>
  )
}

function extractPastedImages(e: React.ClipboardEvent<HTMLTextAreaElement>): File[] {
  const cd = e.clipboardData
  if (!cd) return []
  const itemFiles = Array.from(cd.items ?? [])
    .filter((it) => it.kind === "file")
    .map((it) => it.getAsFile())
    .filter((f): f is File => Boolean(f))
  // Many browsers expose the same pasted image in BOTH `.items` and `.files`.
  // Prefer `.items` when available to avoid duplicates.
  const base = itemFiles.length ? itemFiles : Array.from(cd.files ?? [])
  const imgs = base.filter((f) =>
    String(f.type || "")
      .toLowerCase()
      .startsWith("image/"),
  )
  if (!imgs.length) return []

  const seen = new Set<string>()
  const deduped: File[] = []
  for (const f of imgs) {
    const key = `${f.name}::${f.type}::${f.size}::${f.lastModified}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(f)
  }
  return deduped
}

function dataTransferHasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false
  const hasFileItem = Array.from(dt.items ?? []).some((item) => item.kind === "file")
  if (hasFileItem) return true
  return Array.from(dt.types ?? []).includes("Files")
}

function extractDroppedFiles(e: React.DragEvent): File[] {
  const dt = e.dataTransfer
  if (!dt) return []
  const itemFiles = Array.from(dt.items ?? [])
    .filter((it) => it.kind === "file")
    .map((it) => it.getAsFile())
    .filter((f): f is File => Boolean(f))
  const base = itemFiles.length ? itemFiles : Array.from(dt.files ?? [])
  const imgs = base.filter((f) =>
    String(f.type || "")
      .toLowerCase()
      .startsWith("image/"),
  )
  if (!imgs.length) return []

  const seen = new Set<string>()
  const deduped: File[] = []
  for (const f of imgs) {
    const key = `${f.name}::${f.type}::${f.size}::${f.lastModified}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(f)
  }
  return deduped
}

function toCssLength(value: number | string): string {
  return typeof value === "number" ? `${value}px` : value
}

function hasCopySelectionTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement) {
    return target.selectionStart !== target.selectionEnd
  }
  if (target instanceof HTMLInputElement) {
    const type = String(target.type || "").toLowerCase()
    if (type !== "text" && type !== "search" && type !== "url" && type !== "tel" && type !== "password") return false
    const start = typeof target.selectionStart === "number" ? target.selectionStart : 0
    const end = typeof target.selectionEnd === "number" ? target.selectionEnd : 0
    return start !== end
  }
  return false
}

export function PromptComposer(props: {
  t: (k: string) => string
  value: string
  onValueChange: (v: string) => void
  textareaRef?: React.Ref<HTMLTextAreaElement>

  pending?: boolean
  saving?: boolean
  anyUploading?: boolean

  model?: string
  onModelChange?: (m: string) => void
  groupedModels?: PromptComposerModelGroup[]
  modelsLoading?: boolean

  attachments: PromptComposerAttachment[]
  onPickImages?: (files: File[]) => void | Promise<void>
  onRemoveAttachment?: (id: string) => void
  onAttachmentClick?: (att: PromptComposerAttachment) => void

  /** "landing" = tall auto-sizing textarea (for /agent welcome); "chat" = compact fixed-height (for /agent/ch-xxx) */
  variant?: "landing" | "chat"
  chrome?: "full" | "message-edit"
  textareaMaxHeight?: number | string
  textareaMaxRows?: number
  showModelSelector?: boolean
  showImageUploadButton?: boolean
  sendButtonClassName?: string
  messageEditActions?: React.ReactNode
  attachmentRemovable?: boolean
  messageEditShowLeftControls?: boolean
  containerClassName?: string
  inputGroupClassName?: string
  mode: "send-only" | "send-or-stop"
  pendingIndicator?: "spinner" | "square"
  onSubmit: () => void
  onStop?: () => void
  disableSubmitWhenIdle: boolean
}) {
  const {
    t,
    value,
    onValueChange,
    textareaRef,
    pending = false,
    saving = false,
    anyUploading = false,
    model,
    onModelChange,
    groupedModels = [],
    modelsLoading = false,
    attachments,
    onPickImages,
    onRemoveAttachment,
    onAttachmentClick,
    variant = "chat",
    chrome = "full",
    textareaMaxHeight,
    textareaMaxRows,
    showModelSelector = true,
    showImageUploadButton = true,
    sendButtonClassName,
    messageEditActions,
    attachmentRemovable = true,
    messageEditShowLeftControls = false,
    containerClassName,
    inputGroupClassName,
    mode,
    pendingIndicator = "square",
    onSubmit,
    onStop,
    disableSubmitWhenIdle,
  } = props

  const isLanding = variant === "landing"
  const isMessageEdit = chrome === "message-edit"
  const isAutoSizing = isLanding || isMessageEdit

  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const textareaInnerRef = React.useRef<HTMLTextAreaElement | null>(null)
  const dragDepthRef = React.useRef(0)
  const [textareaMaxRowsPx, setTextareaMaxRowsPx] = React.useState<number | null>(null)
  const [isFileDragging, setIsFileDragging] = React.useState(false)

  const setTextareaRef = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaInnerRef.current = node
      if (!textareaRef) return
      if (typeof textareaRef === "function") {
        textareaRef(node)
      } else {
        textareaRef.current = node
      }
    },
    [textareaRef],
  )

  React.useLayoutEffect(() => {
    if (!isAutoSizing || !textareaMaxRows || textareaMaxRows <= 0) {
      setTextareaMaxRowsPx(null)
      return
    }
    const el = textareaInnerRef.current
    if (!el) return
    const style = window.getComputedStyle(el)
    const lineHeight = Number.parseFloat(style.lineHeight)
    const paddingTop = Number.parseFloat(style.paddingTop)
    const paddingBottom = Number.parseFloat(style.paddingBottom)
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      setTextareaMaxRowsPx(null)
      return
    }
    setTextareaMaxRowsPx(Math.ceil(lineHeight * textareaMaxRows + paddingTop + paddingBottom))
  }, [isAutoSizing, textareaMaxRows, value])

  const textareaStyle = React.useMemo<React.CSSProperties>(() => {
    const style: React.CSSProperties = isAutoSizing ? {} : ({ fieldSizing: "fixed" } as React.CSSProperties)
    const candidates: number[] = []
    if (typeof textareaMaxHeight !== "undefined") {
      if (typeof textareaMaxHeight === "number") {
        candidates.push(textareaMaxHeight)
      } else {
        style.maxHeight = toCssLength(textareaMaxHeight)
      }
    }
    if (typeof textareaMaxRowsPx === "number") candidates.push(textareaMaxRowsPx)
    if (candidates.length > 0) {
      style.maxHeight = `${Math.min(...candidates)}px`
    } else if (isAutoSizing && typeof textareaMaxHeight === "undefined") {
      style.maxHeight = "40vh"
    }
    return style
  }, [isAutoSizing, textareaMaxHeight, textareaMaxRowsPx])

  const onSendOrStop = React.useCallback(() => {
    if (mode === "send-or-stop" && pending) {
      onStop?.()
      return
    }
    onSubmit()
  }, [mode, pending, onStop, onSubmit])

  React.useEffect(() => {
    if (mode !== "send-or-stop" || !pending || !onStop) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return
      const isStopShortcut = e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "c"
      if (!isStopShortcut) return
      if (hasCopySelectionTarget(e.target)) return
      if ((window.getSelection()?.toString() || "").length > 0) return
      e.preventDefault()
      onStop()
    }
    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [mode, pending, onStop])

  const onDownloadAttachment = React.useCallback((a: PromptComposerAttachment) => {
    if (!a.previewUrl || a.uploading) return
    const link = document.createElement("a")
    link.href = a.previewUrl
    link.download = a.filename || "file"
    link.rel = "noreferrer"
    document.body.appendChild(link)
    link.click()
    link.remove()
  }, [])

  const submitDisabled =
    mode === "send-or-stop"
      ? !pending && (disableSubmitWhenIdle || anyUploading)
      : pending || anyUploading || disableSubmitWhenIdle

  const clearDragState = React.useCallback(() => {
    dragDepthRef.current = 0
    setIsFileDragging(false)
  }, [])

  const onDragEnter = React.useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (!onPickImages || !dataTransferHasFiles(e.dataTransfer)) return
      e.preventDefault()
      dragDepthRef.current += 1
      setIsFileDragging(true)
    },
    [onPickImages],
  )

  const onDragOver = React.useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (!onPickImages || !dataTransferHasFiles(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
      if (!isFileDragging) setIsFileDragging(true)
    },
    [isFileDragging, onPickImages],
  )

  const onDragLeave = React.useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (!onPickImages || !dataTransferHasFiles(e.dataTransfer)) return
      e.preventDefault()
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) setIsFileDragging(false)
    },
    [onPickImages],
  )

  const onDropFiles = React.useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (!onPickImages || !dataTransferHasFiles(e.dataTransfer)) return
      e.preventDefault()
      const droppedFiles = extractDroppedFiles(e)
      clearDragState()
      if (!droppedFiles.length) return
      void onPickImages(droppedFiles)
    },
    [clearDragState, onPickImages],
  )

  const rootDropHandlers = React.useMemo(
    () => ({
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop: onDropFiles,
    }),
    [onDragEnter, onDragLeave, onDragOver, onDropFiles],
  )

  function renderAttachments() {
    if (attachments.length === 0) return null
    const imageAttachments = attachments.filter((a) =>
      String(a.mediaType || "")
        .toLowerCase()
        .startsWith("image/"),
    )
    const fileAttachments = attachments.filter(
      (a) =>
        !String(a.mediaType || "")
          .toLowerCase()
          .startsWith("image/"),
    )
    return (
      <div className="w-full shrink-0 p-2 pb-0">
        {imageAttachments.length > 0 ? (
          <div className="u-scrollbar-hidden flex max-w-full gap-2 overflow-x-auto">
            {imageAttachments.map((a) => (
              <div
                key={a.id}
                className="group relative h-10 w-10 shrink-0 overflow-hidden rounded-md border"
                title={a.filename}
              >
                <button
                  type="button"
                  className="absolute inset-0 z-0 cursor-zoom-in"
                  aria-label={t("common.openAction")}
                  onClick={() => onAttachmentClick?.(a)}
                  disabled={pending || saving}
                />
                <div className="pointer-events-none relative h-10 w-10">
                  <AttachmentThumbImage
                    src={a.previewUrl}
                    alt={a.filename}
                    uploading={a.uploading}
                    dimmed={a.uploading}
                  />
                </div>
                {attachmentRemovable && onRemoveAttachment ? (
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment(a.id)}
                    className={cn(
                      "absolute right-0.5 top-0.5 z-10 grid size-5 place-items-center rounded-full border border-white/20 bg-black/55 hover:bg-black/65 text-white shadow-sm backdrop-blur-sm",
                      "opacity-0 scale-95 transition-all duration-150 group-hover:opacity-100 group-hover:scale-100 cursor-pointer",
                    )}
                    aria-label={t("workflows.orchestrator.attachments.removeImageAriaLabel")}
                    disabled={pending || saving}
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
                {a.error ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-destructive/70 px-1 py-0.5 text-[10px] text-white">
                    {t("workflows.orchestrator.attachments.failedBadge")}
                  </div>
                ) : null}
              </div>
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
              <div
                key={a.id}
                className="group relative h-7 w-40 shrink-0 overflow-hidden rounded-md border bg-background"
                title={a.filename}
              >
                <div className="flex h-full items-center gap-1.5 px-2 text-xs text-muted-foreground">
                  {a.uploading ? (
                    <Spinner className="size-3.5 shrink-0 text-foreground/70" />
                  ) : (
                    <FileText className="size-3.5 shrink-0 text-foreground/70" />
                  )}
                  <span className="truncate">{a.filename}</span>
                </div>
                <div className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 opacity-0 scale-95 transition-all duration-150 group-hover:opacity-100 group-hover:scale-100">
                  <button
                    type="button"
                    onClick={() => onDownloadAttachment(a)}
                    className="grid size-5 place-items-center cursor-pointer rounded-full border border-white/20 bg-black/55 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/65"
                    aria-label={t("common.downloadAction")}
                    disabled={pending || saving || a.uploading}
                  >
                    <Download className="size-3.5" />
                  </button>
                  {attachmentRemovable && onRemoveAttachment ? (
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment(a.id)}
                      className="grid size-5 place-items-center cursor-pointer rounded-full border border-white/20 bg-black/55 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/65"
                      aria-label={t("workflows.orchestrator.attachments.removeImageAriaLabel")}
                      disabled={pending || saving}
                    >
                      <X className="size-3.5" />
                    </button>
                  ) : null}
                </div>
                {a.error ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-destructive/70 px-1 py-0.5 text-[10px] text-white">
                    {t("workflows.orchestrator.attachments.failedBadge")}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  function renderTextareaAndAddon() {
    return (
      <>
        <InputGroupTextarea
          ref={setTextareaRef}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={t("workflows.orchestrator.composerPlaceholder")}
          className={cn(
            isAutoSizing
              ? cn(
                  "field-sizing-content w-full px-3 text-base md:text-sm text-wrap overflow-y-auto",
                  isMessageEdit ? "min-h-0" : "min-h-30",
                )
              : "min-h-0 flex-1 w-full px-3 text-base md:text-sm overflow-y-auto",
            "py-3 resize-none rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent",
          )}
          style={textareaStyle}
          disabled={pending || saving}
          onPaste={(e) => {
            if (!onPickImages) return
            const pastedFiles = extractPastedImages(e)
            if (!pastedFiles.length) return
            e.preventDefault()
            void onPickImages(pastedFiles)
          }}
          onKeyDown={(e) => {
            const native = e.nativeEvent as KeyboardEvent | undefined
            if (native?.isComposing) return
            const isSendShortcut = e.key === "Enter" && !e.shiftKey
            if (isSendShortcut) {
              e.preventDefault()
              onSubmit()
            }
          }}
        />

        {!isMessageEdit || messageEditActions ? (
          <InputGroupAddon align="block-end" className="order-last w-full justify-between px-3 pb-3">
            <div className="flex items-center gap-2 min-w-0">
              {!isMessageEdit || messageEditShowLeftControls ? (
                <>
                  {showModelSelector ? (
                    modelsLoading ? (
                      <Skeleton className="h-7 w-34 rounded-full bg-background/40" />
                    ) : (
                      <Select value={model} onValueChange={onModelChange} disabled={pending || saving}>
                        <SelectTrigger
                          className={cn("!h-7 rounded-full px-2 text-xs shadow-none", "w-fit max-w-[55vw]")}
                          aria-label={t("settings.agent.model")}
                        >
                          <SelectValue placeholder={t("settings.agent.modelPlaceholder")} />
                        </SelectTrigger>
                        <SelectContent align="start">
                          {groupedModels.map((g, idx) => (
                            <SelectGroup key={g.provider}>
                              <SelectLabel>{g.provider}</SelectLabel>
                              {g.models.map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  {m.name}
                                </SelectItem>
                              ))}
                              {idx < groupedModels.length - 1 ? <SelectSeparator /> : null}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                    )
                  ) : null}

                  {showImageUploadButton ? (
                    <>
                      <InputGroupButton
                        variant="outline"
                        size="icon-xs"
                        className="size-7 rounded-full p-0"
                        aria-label={t("workflows.orchestrator.attachments.uploadImageAriaLabel")}
                        onClick={() => fileInputRef.current?.click()}
                        disabled={pending || saving}
                      >
                        <Plus className="size-5" />
                      </InputGroupButton>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const picked = Array.from(e.target.files ?? [])
                          e.currentTarget.value = ""
                          void onPickImages?.(picked)
                        }}
                      />
                    </>
                  ) : null}
                </>
              ) : null}
            </div>

            {isMessageEdit ? (
              <div className="ml-auto flex items-center gap-2">{messageEditActions}</div>
            ) : (
              <InputGroupButton
                variant="default"
                size="icon-xs"
                className={cn("size-7 rounded-full p-0", sendButtonClassName)}
                onClick={onSendOrStop}
                disabled={submitDisabled}
                aria-label={
                  pending && mode === "send-or-stop" ? t("common.cancelAction") : t("workflows.orchestrator.sendAction")
                }
              >
                {pending ? (
                  pendingIndicator === "spinner" ? (
                    <Spinner className="size-5" />
                  ) : (
                    <Square className="size-4" />
                  )
                ) : (
                  <ArrowUp className="size-5" />
                )}
                <span className="sr-only">
                  {pending && mode === "send-or-stop"
                    ? t("common.cancelAction")
                    : t("workflows.orchestrator.sendAction")}
                </span>
              </InputGroupButton>
            )}
          </InputGroupAddon>
        ) : null}
      </>
    )
  }

  if (isLanding) {
    return (
      <InputGroup
        className={cn(
          "has-[>textarea]:h-auto h-auto transition-colors",
          isFileDragging ? "ring-2 ring-primary/40 border-primary/40" : "",
          inputGroupClassName,
        )}
        {...rootDropHandlers}
      >
        {renderAttachments()}
        {renderTextareaAndAddon()}
      </InputGroup>
    )
  }

  return (
    <div
      className={cn(
        isMessageEdit ? "flex min-h-0 flex-col bg-background" : "flex h-full min-h-0 flex-col bg-background",
        "transition-colors",
        isFileDragging ? "ring-2 ring-primary/40 border-primary/40 rounded-md" : "",
        containerClassName,
      )}
      {...rootDropHandlers}
    >
      {renderAttachments()}
      <InputGroup
        className={cn(
          isMessageEdit ? "min-h-0 has-[>textarea]:h-auto h-auto" : "min-h-0 flex-1 has-[>textarea]:h-auto h-auto",
          "!border-0 !shadow-none !bg-transparent dark:!bg-transparent",
          "has-[[data-slot=input-group-control]:focus-visible]:!border-0 has-[[data-slot=input-group-control]:focus-visible]:!ring-0",
          inputGroupClassName,
        )}
      >
        {renderTextareaAndAddon()}
      </InputGroup>
    </div>
  )
}
