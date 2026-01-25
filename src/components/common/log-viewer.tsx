"use client"

import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { Check, Copy, WrapText } from "lucide-react"

import { cn } from "@/lib/utils"
import { ScrollBar } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Toggle } from "@/components/ui/toggle"
import { formatLogTs, levelClass, levelGutterClass } from "@/lib/shared/format/logs"
import { copyTextToClipboard } from "@/lib/client/clipboard"
import { toast } from "@/lib/client/toast"
import { useI18nOptional } from "@/components/i18n-provider"

export type LogViewerLine = {
  id?: string | number
  ts?: string
  level?: string
  stream?: "stdout" | "stderr" | string
  line: string
}

export function LogViewer(props: {
  lines: LogViewerLine[]
  className?: string
  empty?: React.ReactNode
  /**
   * Extra action buttons to render alongside the built-in wrap/copy actions.
   * Use ghost icon buttons for visual consistency.
   */
  actions?: React.ReactNode
  /**
   * If `level` is missing, this function determines the displayed level string (e.g. map stderr->WARN).
   */
  fallbackLevel?: (line: LogViewerLine) => string
  /**
   * When true (default), wraps content in a ScrollArea.
   * When false, renders only the log rows (caller provides scroll container).
   */
  scroll?: boolean
  /**
   * Enable/disable line wrapping (default true).
   */
  defaultWrap?: boolean
  /**
   * Show wrap/copy actions (default true).
   */
  showActions?: boolean
  /**
   * Show actions only on hover (default true). If false, actions are always visible.
   */
  showOnHover?: boolean
  /**
   * Customize copied text. Defaults to joining raw log lines with "\n".
   */
  getCopyText?: (lines: LogViewerLine[]) => string
  /**
   * Imperative scroll request to bring a specific line index into view.
   * Use a monotonically increasing version to re-trigger.
   */
  scrollRequest?: { version: number; index: number; align?: ScrollLogicalPosition }
  /**
   * Imperative highlight request for a specific line index (visual emphasis).
   * Use a monotonically increasing version to re-trigger.
   */
  highlightRequest?: { version: number; index: number; ttlMs?: number }
}) {
  const i18n = useI18nOptional()
  const empty = props.empty ?? <div className="text-muted-foreground">—</div>
  const [wrap, setWrap] = React.useState(props.defaultWrap ?? true)
  const [copied, setCopied] = React.useState(false)

  const targetRef = React.useRef<HTMLDivElement | null>(null)
  const lastScrollVersionRef = React.useRef<number>(0)
  React.useEffect(() => {
    const req = props.scrollRequest
    if (!req) return
    if (!req.version) return
    if (req.version === lastScrollVersionRef.current) return
    lastScrollVersionRef.current = req.version
    const align = req.align ?? "center"
    const idx = Number(req.index ?? 0)
    if (!Number.isFinite(idx) || idx < 0) return
    window.requestAnimationFrame(() => {
      targetRef.current?.scrollIntoView({ block: align })
    })
  }, [props.scrollRequest])

  const [highlightIndex, setHighlightIndex] = React.useState<number | null>(null)
  const lastHighlightVersionRef = React.useRef<number>(0)
  React.useEffect(() => {
    const req = props.highlightRequest
    if (!req) return
    if (!req.version) return
    if (req.version === lastHighlightVersionRef.current) return
    lastHighlightVersionRef.current = req.version
    const idx = Number(req.index ?? 0)
    if (!Number.isFinite(idx) || idx < 0) return
    setHighlightIndex(idx)
    const ttl = Number.isFinite(Number(req.ttlMs)) ? Number(req.ttlMs) : 1500
    const tmr = window.setTimeout(() => setHighlightIndex((cur) => (cur === idx ? null : cur)), Math.max(300, ttl))
    return () => window.clearTimeout(tmr)
  }, [props.highlightRequest])

  React.useEffect(() => {
    if (!copied) return
    const tmr = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(tmr)
  }, [copied])

  const content = (
    <div className={cn("p-3 font-mono text-xs", props.className)}>
      {props.lines.length === 0
        ? empty
        : props.lines.map((l, idx) => {
            const key = l.id ?? `${idx}:${l.ts ?? ""}:${l.line.slice(0, 32)}`
            const displayLevel =
              (l.level && String(l.level)) ||
              (props.fallbackLevel ? props.fallbackLevel(l) : l.stream === "stderr" ? "WARN" : "INFO")

            return (
              <div
                key={key}
                ref={props.scrollRequest && idx === props.scrollRequest.index ? targetRef : null}
                className={cn(
                  "flex items-start gap-2 rounded-sm py-0.5 px-1 -mx-1 transition-colors",
                  highlightIndex === idx ? "bg-amber-500/15 ring-1 ring-amber-500/30" : "",
                )}
              >
                <span
                  className={cn("h-4 w-1.5 shrink-0 rounded-sm", levelGutterClass(displayLevel))}
                  aria-hidden="true"
                />
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-muted-foreground">{formatLogTs(l.ts)}</span>
                  <span className={cn("font-semibold", levelClass(displayLevel))}>
                    {String(displayLevel || "INFO").toUpperCase()}
                  </span>
                  <span className={cn("text-foreground break-words", wrap ? "whitespace-pre-wrap" : "whitespace-pre")}>
                    {l.line}
                  </span>
                </div>
              </div>
            )
          })}
    </div>
  )

  const actions =
    props.showActions === false ? null : (
      <div
        className={cn(
          "absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md bg-background/85 p-1",
          props.showOnHover === false
            ? ""
            : "pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
        )}
      >
        {props.actions}
        <Toggle
          size="sm"
          pressed={wrap}
          onPressedChange={setWrap}
          aria-label={wrap ? "Disable wrap" : "Enable wrap"}
          title={wrap ? "Disable wrap" : "Enable wrap"}
        >
          <WrapText className="size-4" />
        </Toggle>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={async () => {
            const txt = props.getCopyText ? props.getCopyText(props.lines) : props.lines.map((x) => x.line).join("\n")
            try {
              await copyTextToClipboard(txt)
              setCopied(true)
              toast.info(i18n ? i18n.t("common.copied") : "Copied")
            } catch {
              toast.error(i18n ? i18n.t("common.copyActionFailed") : "Copy failed")
            }
          }}
          aria-label="Copy"
          title="Copy"
          className="h-8 w-8"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
    )

  if (props.scroll === false) {
    return (
      <div className="group relative flex h-full w-full flex-col overflow-hidden">
        {actions}
        <div className={cn("flex-1 overflow-auto pt-10", wrap ? "" : "overflow-x-auto")}>{content}</div>
      </div>
    )
  }

  return (
    <ScrollAreaPrimitive.Root type="always" className="group relative flex h-full w-full flex-col overflow-hidden">
      {actions}
      <ScrollAreaPrimitive.Viewport className={cn("h-full w-full", wrap ? "" : "overflow-x-auto")}>
        {content}
      </ScrollAreaPrimitive.Viewport>
      {/* Vertical scrollbar should always be present if scrolling is possible */}
      <ScrollBar orientation="vertical" />
      {/* Horizontal scrollbar depends on wrap mode */}
      {/* Keep horizontal scrollbar mounted so touch devices can always pan horizontally when content overflows */}
      <ScrollBar orientation="horizontal" className={wrap ? "hidden" : ""} />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
