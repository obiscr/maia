"use client"

import { Download, FileIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function isImageMediaType(mediaType: string): boolean {
  return mediaType.startsWith("image/")
}

function isAudioMediaType(mediaType: string): boolean {
  return mediaType.startsWith("audio/")
}

function isVideoMediaType(mediaType: string): boolean {
  return mediaType.startsWith("video/")
}

export function MessageFilePart(props: {
  url: string
  mediaType: string
  filename?: string
  t: (k: string) => string
  className?: string
}) {
  const { url, mediaType, filename, t } = props
  const displayName = filename || t("workflows.orchestrator.attachments.fallbackFileName")

  if (isImageMediaType(mediaType)) {
    return (
      <div className={cn("my-1.5 w-full max-w-2xl", props.className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={displayName}
          loading="lazy"
          decoding="async"
          className="rounded-md border w-full h-auto object-contain"
        />
        {filename ? <div className="mt-1 text-[10px] text-muted-foreground truncate">{filename}</div> : null}
      </div>
    )
  }

  if (isAudioMediaType(mediaType)) {
    return (
      <div className={cn("my-1.5 w-full max-w-md space-y-1", props.className)}>
        <audio controls preload="metadata" className="w-full">
          <source src={url} type={mediaType} />
        </audio>
        {filename ? <div className="text-[10px] text-muted-foreground truncate">{filename}</div> : null}
      </div>
    )
  }

  if (isVideoMediaType(mediaType)) {
    return (
      <div className={cn("my-1.5 w-full max-w-2xl space-y-1", props.className)}>
        <video controls preload="metadata" className="rounded-md border w-full">
          <source src={url} type={mediaType} />
        </video>
        {filename ? <div className="text-[10px] text-muted-foreground truncate">{filename}</div> : null}
      </div>
    )
  }

  const shortType = mediaType.includes("/") ? mediaType.split("/").pop()!.toUpperCase() : mediaType.toUpperCase()

  return (
    <a
      href={url}
      download={filename || true}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group my-1.5 flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2",
        "hover:bg-muted/40 transition-colors",
        "max-w-full text-xs text-foreground no-underline overflow-hidden",
        props.className,
      )}
    >
      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{displayName}</span>
      <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground font-mono">
        {shortType}
      </span>
      <Download className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </a>
  )
}
