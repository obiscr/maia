"use client"

import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { Check, Copy, WrapText } from "lucide-react"

import { cn } from "@/lib/utils"
import { ScrollBar } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Toggle } from "@/components/ui/toggle"
import { highlightCodeHtml } from "@/lib/shared/format/code"
import { copyTextToClipboard } from "@/lib/client/clipboard"
import { toast } from "@/lib/client/toast"
import { useI18nOptional } from "@/components/i18n-provider"
import { safeJsonStringifyPrettyOrEmpty } from "@/lib/shared/lang/safe-json"

function toPrettyJsonString(value: unknown) {
  if (value == null) return ""
  if (typeof value === "string") {
    const s = value.trim()
    if (!s) return ""
    try {
      return JSON.stringify(JSON.parse(s), null, 2)
    } catch {
      return value
    }
  }
  return safeJsonStringifyPrettyOrEmpty(value)
}

export function JsonViewer(props: {
  value: unknown
  className?: string
  empty?: React.ReactNode
  preClassName?: string
  /**
   * When true (default), wraps in ScrollArea.
   * When false, renders only the <pre> content (caller provides scroll container).
   */
  scroll?: boolean
  /**
   * Enable/disable wrapping (default true).
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
   * If provided, used as the copied "raw" text.
   */
  getCopyText?: (value: unknown) => string
}) {
  const i18n = useI18nOptional()
  const t = i18n?.t ?? ((key: string) => key)
  const empty = props.empty ?? <pre className="p-4 text-xs whitespace-pre-wrap">{t("common.noData")}</pre>
  const [wrap, setWrap] = React.useState(props.defaultWrap ?? true)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!copied) return
    const tmr = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(tmr)
  }, [copied])

  const pretty = React.useMemo(() => toPrettyJsonString(props.value), [props.value])
  const html = React.useMemo(() => (pretty ? highlightCodeHtml(pretty, "json") : ""), [pretty])

  const content = pretty ? (
    <pre
      className={cn(
        "p-4 font-mono text-xs",
        wrap ? "break-words whitespace-pre-wrap" : "whitespace-pre w-max",
        props.preClassName,
      )}
    >
      <code className="hljs language-json" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  ) : (
    empty
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
            const raw = props.getCopyText
              ? props.getCopyText(props.value)
              : typeof props.value === "string"
                ? props.value
                : pretty || ""
            try {
              await copyTextToClipboard(raw)
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
      <div className={cn("group relative flex h-full w-full flex-col overflow-hidden", props.className)}>
        {actions}
        <div className={cn("flex-1 overflow-auto pt-10", wrap ? "" : "overflow-x-auto")}>{content}</div>
      </div>
    )
  }

  return (
    <ScrollAreaPrimitive.Root
      type="always"
      className={cn("group relative flex h-full w-full flex-col overflow-hidden", props.className)}
    >
      {actions}
      <ScrollAreaPrimitive.Viewport className={cn("h-full w-full", wrap ? "" : "overflow-x-auto")}>
        {content}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar orientation="vertical" />
      {/* Keep horizontal scrollbar mounted so touch devices can always pan horizontally when content overflows */}
      <ScrollBar orientation="horizontal" className={wrap ? "hidden" : ""} />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
