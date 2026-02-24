"use client"

import { FileText } from "lucide-react"

import { cn } from "@/lib/utils"

export function MessageSourceDocument(props: {
  sourceId: string
  mediaType: string
  title: string
  filename?: string
  className?: string
}) {
  const { title, filename, mediaType } = props
  const displayTitle = title || filename || "Document"

  const shortType = mediaType.includes("/") ? mediaType.split("/").pop()!.toUpperCase() : mediaType.toUpperCase()

  return (
    <div
      className={cn(
        "my-1.5 flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2",
        "max-w-full text-xs text-foreground overflow-hidden",
        props.className,
      )}
    >
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
      <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground font-mono">
        {shortType}
      </span>
    </div>
  )
}
