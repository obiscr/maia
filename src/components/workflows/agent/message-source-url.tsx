"use client"

import * as React from "react"
import { ExternalLink } from "lucide-react"

import { cn } from "@/lib/utils"

export function MessageSourceUrl(props: { sourceId: string; url: string; title?: string; className?: string }) {
  const { url, title } = props
  const displayTitle = title || url

  const faviconUrl = React.useMemo(() => {
    try {
      const u = new URL(url)
      return `https://www.google.com/s2/favicons?sz=32&domain=${u.hostname}`
    } catch {
      return null
    }
  }, [url])

  const hostname = React.useMemo(() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "")
    } catch {
      return url
    }
  }, [url])

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group my-1.5 flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2",
        "hover:bg-muted/40 transition-colors",
        "max-w-full text-xs text-foreground no-underline overflow-hidden",
        props.className,
      )}
    >
      {faviconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={faviconUrl} alt="" className="size-4 shrink-0 rounded-sm" />
      ) : (
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground">{hostname}</span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </a>
  )
}
