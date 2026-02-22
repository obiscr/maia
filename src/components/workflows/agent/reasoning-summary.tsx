"use client"

import * as React from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

import { ChatMarkdown } from "@/components/common/markdown/chat-markdown"
import { ChatStreamdown } from "@/components/common/markdown/chat-streamdown"
import { cn } from "@/lib/utils"

export function ReasoningSummary(props: {
  text: string
  fallbackTitle: string
  doneTitle?: string
  streaming?: boolean
  defaultOpen?: boolean
  className?: string
}) {
  const text = String(props.text ?? "").trim()
  const hasBody = Boolean(text)

  const startTimeRef = React.useRef<number>(Date.now())
  const [elapsedSeconds, setElapsedSeconds] = React.useState<number | null>(null)

  const [open, setOpen] = React.useState<boolean>(() => props.defaultOpen ?? true)
  const hasUserToggledRef = React.useRef(false)

  React.useEffect(() => {
    if (props.streaming) {
      startTimeRef.current = Date.now()
      setElapsedSeconds(null)
    } else if (elapsedSeconds === null) {
      const ms = Date.now() - startTimeRef.current
      setElapsedSeconds(Math.max(1, Math.round(ms / 1000)))
      if (!hasUserToggledRef.current) setOpen(false)
    }
  }, [props.streaming])

  const title = React.useMemo(() => {
    if (props.streaming) return props.fallbackTitle || "Thinking..."
    if (elapsedSeconds !== null && props.doneTitle) {
      return props.doneTitle.replace("{seconds}", String(elapsedSeconds))
    }
    return props.fallbackTitle || "Thinking..."
  }, [props.streaming, props.fallbackTitle, props.doneTitle, elapsedSeconds])

  return (
    <div className={cn("w-full max-w-full", props.className)}>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-1 px-1 py-1 text-left text-muted-foreground/65",
          hasBody ? "cursor-pointer" : "cursor-default",
        )}
        onClick={() => {
          if (!hasBody) return
          hasUserToggledRef.current = true
          setOpen((v) => !v)
        }}
        disabled={!hasBody}
      >
        <div className="min-w-0 truncate whitespace-nowrap text-sm">{title}</div>
        {hasBody ? (
          open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
          )
        ) : null}
      </button>

      {open && hasBody ? (
        <div
          className="min-w-0 w-full text-sm px-1 text-muted-foreground/65 leading-relaxed"
          style={
            {
              "--maia-color-foreground": "color-mix(in oklab, var(--maia-color-muted-foreground) 65%, transparent)",
            } as React.CSSProperties
          }
        >
          {props.streaming ? (
            <ChatStreamdown markdown={text} className="maia-mdx" />
          ) : (
            <ChatMarkdown markdown={text} className="maia-mdx" />
          )}
        </div>
      ) : null}
    </div>
  )
}
