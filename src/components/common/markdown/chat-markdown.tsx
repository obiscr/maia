"use client"

import * as React from "react"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkRehype from "remark-rehype"
import rehypeStringify from "rehype-stringify"
import { visit } from "unist-util-visit"

import { apiFetchJson } from "@/lib/shared/http/api"
import { cn } from "@/lib/utils"

type Props = {
  markdown: string
  className?: string
  /**
   * When true, the markdown is still streaming/growing. In this state we avoid expensive server-side rendering
   * to prevent request storms and UI jank.
   */
  streaming?: boolean
}

function stripRawHtml() {
  return (tree: any) => {
    visit(tree, "html", (_node: any, index: any, parent: any) => {
      if (!parent || typeof index !== "number") return
      parent.children[index] = { type: "text", value: "" }
    })
  }
}

function stripJavascriptHrefs() {
  return (tree: any) => {
    visit(tree, "element", (node: any) => {
      if (node?.tagName !== "a") return
      const href = String(node?.properties?.href ?? "")
      if (/^\s*javascript:/i.test(href)) node.properties.href = "#"
    })
  }
}

const fastProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(stripRawHtml)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(stripJavascriptHrefs)
  .use(rehypeStringify)

async function renderMarkdownViaApi(markdown: string, signal?: AbortSignal) {
  const json = await apiFetchJson<{ ok?: boolean; html?: string; error?: string }>(`/api/markdown/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown }),
    signal,
  })
  return String(json?.html ?? "")
}

export function ChatMarkdown(props: Props) {
  const [html, setHtml] = React.useState<string>("")
  const [htmlFor, setHtmlFor] = React.useState<string>("")
  const [err, setErr] = React.useState<string | null>(null)

  const deferred = React.useDeferredValue(props.markdown)
  const [debounced, setDebounced] = React.useState<string>(deferred ?? "")

  const fastHtml = React.useMemo(() => {
    try {
      const file = fastProcessor.processSync(deferred ?? "")
      return String(file)
    } catch {
      return ""
    }
  }, [deferred])

  React.useEffect(() => {
    const ms = props.streaming ? 800 : 250
    const t = window.setTimeout(() => setDebounced(deferred ?? ""), ms)
    return () => window.clearTimeout(t)
  }, [deferred, props.streaming])

  React.useEffect(() => {
    if (props.streaming) return
    let cancelled = false
    const controller = new AbortController()
    setErr(null)

    void (async () => {
      try {
        const out = await renderMarkdownViaApi(debounced ?? "", controller.signal)
        if (cancelled) return
        setHtml(out)
        setHtmlFor(debounced ?? "")
      } catch (e) {
        if (cancelled) return
        setErr(e instanceof Error ? e.message : String(e))
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [debounced, props.streaming])

  const canUseApiHtml = !err && html && htmlFor === (props.markdown ?? "")
  const effectiveHtml = canUseApiHtml ? html : fastHtml

  if (!effectiveHtml) {
    return <div className={cn(props.className, "whitespace-pre-wrap break-words")}>{props.markdown}</div>
  }

  return <div className={props.className} dangerouslySetInnerHTML={{ __html: effectiveHtml }} />
}
