"use client"

import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { Check, Copy } from "lucide-react"

import { cn } from "@/lib/utils"
import { ScrollBar } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { highlightCodeHtml, type CodeLanguage } from "@/lib/shared/format/code"
import { copyTextToClipboard } from "@/lib/client/clipboard"
import { toast } from "@/lib/client/toast"
import { useI18nOptional } from "@/components/i18n-provider"

export function CodeViewer(props: {
  code: string
  language?: CodeLanguage
  className?: string
  preClassName?: string
  /**
   * When true (default), wraps in ScrollArea.
   * When false, renders only the <pre> content (caller provides scroll container).
   */
  scroll?: boolean
  /**
   * Show copy action (default true).
   */
  showActions?: boolean
  /**
   * Show action only on hover (default true). If false, action is always visible.
   */
  showOnHover?: boolean
  /**
   * Used as the copied text. Defaults to `code`.
   */
  getCopyText?: (code: string) => string
  /**
   * Override the aria-label/title for copy button.
   */
  copyLabel?: string
}) {
  const i18n = useI18nOptional()
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!copied) return
    const tmr = window.setTimeout(() => setCopied(false), 1200)
    return () => window.clearTimeout(tmr)
  }, [copied])

  const lang = (props.language ?? "javascript") as CodeLanguage
  const html = React.useMemo(() => {
    return highlightCodeHtml(props.code || "", lang)
  }, [props.code, lang])

  const content = (
    <pre className={cn("p-4 font-mono text-xs whitespace-pre w-max", props.preClassName)}>
      <code
        className={cn("hljs", props.language ? `language-${String(props.language)}` : "")}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </pre>
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
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={async () => {
            const raw = props.getCopyText ? props.getCopyText(props.code) : props.code || ""
            try {
              await copyTextToClipboard(raw)
              setCopied(true)
              toast.info(i18n ? i18n.t("common.copied") : "Copied")
            } catch {
              toast.error(i18n ? i18n.t("common.copyActionFailed") : "Copy failed")
            }
          }}
          aria-label={props.copyLabel ?? "Copy"}
          title={props.copyLabel ?? "Copy"}
          className="h-8 w-8"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
    )

  if (props.scroll === false) {
    return (
      <div className={cn("group relative min-h-0 flex flex-1 flex-col overflow-hidden", props.className)}>
        {actions}
        <div className="min-h-0 flex-1 overflow-auto pt-10">{content}</div>
      </div>
    )
  }

  return (
    <ScrollAreaPrimitive.Root
      type="always"
      className={cn("group relative min-h-0 flex flex-1 flex-col overflow-hidden", props.className)}
    >
      {actions}
      <ScrollAreaPrimitive.Viewport className="min-h-0 flex-1 overflow-x-auto">{content}</ScrollAreaPrimitive.Viewport>
      <ScrollBar orientation="vertical" />
      {/* Keep horizontal scrollbar mounted so touch devices can always pan horizontally when content overflows */}
      <ScrollBar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
