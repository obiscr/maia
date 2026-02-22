"use client"

import * as React from "react"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import remarkRehype from "remark-rehype"
import rehypeStringify from "rehype-stringify"
import rehypeHighlight from "rehype-highlight"
import rehypeKatex from "rehype-katex"
import type { Options as RehypeHighlightOptions } from "rehype-highlight"
import rehypeExpressiveCode, { type RehypeExpressiveCodeOptions } from "rehype-expressive-code"
import { pluginCollapsibleSections } from "@expressive-code/plugin-collapsible-sections"
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers"
import { visit } from "unist-util-visit"
import mermaid from "mermaid"
import DOMPurify from "dompurify"
import { cn } from "@/lib/utils"

type Props = {
  markdown: string
  className?: string
}

const mermaidSourceByEl = new WeakMap<HTMLElement, string>()
const renderedMermaidThemeByEl = new WeakMap<HTMLElement, string>()
let mermaidThemeObserver: MutationObserver | null = null
let mermaidRenderScheduled = false

function stripRawHtml() {
  return (tree: any) => {
    visit(tree, "html", (_node: any, index: any, parent: any) => {
      if (!parent || typeof index !== "number") return
      parent.children[index] = { type: "text", value: "" }
    })
  }
}

function processLinks() {
  return (tree: any) => {
    visit(tree, "element", (node: any) => {
      if (node?.tagName !== "a") return
      const href = String(node?.properties?.href ?? "")
      if (/^\s*javascript:/i.test(href)) {
        node.properties.href = "#"
        return
      }
      node.properties.target = "_blank"
      node.properties.rel = "noopener noreferrer"
    })
  }
}

function wrapTables() {
  return (tree: any) => {
    visit(tree, "element", (node: any, index: any, parent: any) => {
      if (node.tagName !== "table") return
      if (!parent || typeof index !== "number") return
      parent.children[index] = {
        type: "element",
        tagName: "div",
        properties: { className: ["maia-table-scroll"] },
        children: [node],
      }
    })
  }
}

function hasMermaidLanguageClass(className: unknown): boolean {
  const classes = Array.isArray(className) ? className.map(String) : typeof className === "string" ? [className] : []
  return classes.some((c) => c === "language-mermaid" || c === "lang-mermaid" || c === "mermaid")
}

function extractMermaidBlocks() {
  return (tree: any) => {
    visit(tree, "element", (node: any, index: any, parent: any) => {
      if (node.tagName !== "pre" || !parent || typeof index !== "number") return
      if (node._mermaidExtracted) return
      const code = node.children?.[0]
      if (code?.tagName !== "code") return
      const className = code?.properties?.className
      if (!hasMermaidLanguageClass(className)) return
      const raw = code.children
        ?.filter((c: any) => c.type === "text")
        .map((c: any) => c.value)
        .join("")
      const chart = String(raw ?? "").trim()
      if (!chart) return
      node._mermaidExtracted = true
      parent.children[index] = {
        type: "element",
        tagName: "div",
        properties: { className: ["maia-mermaid-wrap"] },
        children: [
          {
            type: "element",
            tagName: "div",
            properties: {
              className: ["maia-mermaid", "mermaid", "not-content"],
              "data-mermaid": "true",
            },
            children: [{ type: "text", value: chart }],
          },
          node,
        ],
      }
    })
  }
}

const fastProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(stripRawHtml)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeKatex)
  .use(rehypeHighlight, { detect: false } satisfies RehypeHighlightOptions)
  .use(processLinks)
  .use(wrapTables)
  .use(extractMermaidBlocks)
  .use(rehypeStringify)
  .freeze()

const expressiveCodeOptions: RehypeExpressiveCodeOptions = {
  themes: ["github-light", "github-dark"],
  useDarkModeMediaQuery: false,
  themeCssSelector: (theme) => (theme.name === "github-dark" ? ".dark" : false),
  plugins: [pluginCollapsibleSections(), pluginLineNumbers()],
  defaultProps: { showLineNumbers: false },
  styleOverrides: { frames: { shadowColor: "transparent" } },
}

const enhancedProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(stripRawHtml)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeKatex)
  .use(processLinks)
  .use(wrapTables)
  .use(extractMermaidBlocks)
  .use(rehypeExpressiveCode, expressiveCodeOptions)
  .use(rehypeStringify)
  .freeze()

function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") return html
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["target", "rel", "data-mermaid", "data-language", "data-code", "data-copied"],
    FORBID_TAGS: ["script"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
  })
}

const ENHANCED_CACHE_MAX = 64
const enhancedHtmlCache = new Map<string, string>()

function getCachedEnhancedHtml(key: string): string | undefined {
  const val = enhancedHtmlCache.get(key)
  if (val !== undefined) {
    enhancedHtmlCache.delete(key)
    enhancedHtmlCache.set(key, val)
  }
  return val
}

function setCachedEnhancedHtml(key: string, val: string): void {
  if (enhancedHtmlCache.has(key)) {
    enhancedHtmlCache.delete(key)
  } else if (enhancedHtmlCache.size >= ENHANCED_CACHE_MAX) {
    const oldest = enhancedHtmlCache.keys().next().value
    if (oldest !== undefined) enhancedHtmlCache.delete(oldest)
  }
  enhancedHtmlCache.set(key, val)
}

function legacyCopy(text: string) {
  const el = document.createElement("pre")
  Object.assign(el.style, {
    opacity: "0",
    pointerEvents: "none",
    position: "absolute",
    overflow: "hidden",
    left: "0",
    top: "0",
    width: "20px",
    height: "20px",
    webkitUserSelect: "auto",
    userSelect: "all",
  } as Partial<CSSStyleDeclaration>)
  el.ariaHidden = "true"
  el.textContent = text
  document.body.appendChild(el)
  const range = document.createRange()
  range.selectNode(el)
  const sel = window.getSelection()
  if (!sel) return false
  sel.removeAllRanges()
  sel.addRange(range)
  let ok = false
  try {
    ok = document.execCommand("copy")
  } finally {
    sel.removeAllRanges()
    document.body.removeChild(el)
  }
  return ok
}

function bindExpressiveCodeCopy(container: HTMLElement) {
  const buttons = container.querySelectorAll<HTMLButtonElement>(
    ".expressive-code .copy button:not([data-maia-copy-bound])",
  )
  if (!buttons.length) return

  for (const btn of buttons) {
    btn.dataset.maiaCopyBound = "1"
    btn.addEventListener("click", async (e) => {
      e.preventDefault()
      const current = e.currentTarget as HTMLButtonElement | null
      if (!current) return

      const copiedLabel = current.dataset.copied ?? "Copied!"
      const raw = (current.dataset.code ?? "").replace(/\u007f/g, "\n")
      if (!raw) return

      let ok = false
      try {
        await navigator.clipboard.writeText(raw)
        ok = true
      } catch {
        ok = legacyCopy(raw)
      }
      if (!ok) return

      const copyContainer = current.parentElement
      if (!copyContainer || copyContainer.querySelector(".feedback")) return
      const live = copyContainer.querySelector<HTMLElement>("[aria-live]")
      if (!live) return

      let feedback: HTMLDivElement | undefined = document.createElement("div")
      feedback.classList.add("feedback")
      feedback.append(copiedLabel)
      live.append(feedback)
      void feedback.offsetWidth
      requestAnimationFrame(() => feedback?.classList.add("show"))

      const hide = () => feedback?.classList.remove("show")
      const cleanup = () => {
        if (!feedback) return
        if (parseFloat(getComputedStyle(feedback).opacity) > 0) return
        feedback.remove()
        feedback = undefined
      }

      window.setTimeout(hide, 1500)
      window.setTimeout(cleanup, 2500)
      current.addEventListener("blur", hide, { once: true })
      feedback.addEventListener("transitioncancel", cleanup, { once: true })
      feedback.addEventListener("transitionend", cleanup, { once: true })
    })
  }
}

async function renderAllMermaid() {
  const themeKey = document.documentElement.classList.contains("dark") ? "dark" : "default"
  const m = mermaid
  m.initialize({ startOnLoad: false, theme: themeKey })

  const nodes = Array.from(document.querySelectorAll<HTMLElement>(".maia-mdx .maia-mermaid"))
  for (const el of nodes) {
    const source = (mermaidSourceByEl.get(el) ?? el.textContent ?? "").trim()
    if (!source) continue
    mermaidSourceByEl.set(el, source)
    if (renderedMermaidThemeByEl.get(el) === themeKey) continue

    const id = `mmd-${Math.random().toString(36).slice(2)}`
    try {
      const { svg, bindFunctions } = await m.render(id, source)
      el.innerHTML = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        ADD_TAGS: ["foreignObject"],
      })
      bindFunctions?.(el)
      renderedMermaidThemeByEl.set(el, themeKey)
      el.setAttribute("data-maia-rendered", "true")
    } catch {
      document.getElementById(id)?.remove()
      document.getElementById(`d${id}`)?.remove()
      el.innerHTML = ""
      el.classList.remove("mermaid")
      renderedMermaidThemeByEl.delete(el)
      el.removeAttribute("data-maia-rendered")
      const wrap = el.closest(".maia-mermaid-wrap")
      if (wrap) {
        wrap.classList.add("maia-mermaid-error")
      } else {
        const pre = document.createElement("pre")
        const code = document.createElement("code")
        code.className = "language-mermaid"
        code.textContent = source
        pre.appendChild(code)
        el.appendChild(pre)
      }
    }
  }
}

function scheduleMermaidRender() {
  if (mermaidRenderScheduled) return
  mermaidRenderScheduled = true
  const run = async () => {
    mermaidRenderScheduled = false
    await renderAllMermaid()
  }
  const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void) => void)
  if (typeof ric === "function") ric(() => void run())
  else window.setTimeout(() => void run(), 0)
}

let mermaidObserverRefCount = 0

function acquireMermaidThemeObserver() {
  mermaidObserverRefCount++
  if (mermaidThemeObserver) return
  const html = document.documentElement
  mermaidThemeObserver = new MutationObserver(() => scheduleMermaidRender())
  mermaidThemeObserver.observe(html, { attributes: true, attributeFilter: ["class"] })
}

function releaseMermaidThemeObserver() {
  mermaidObserverRefCount = Math.max(0, mermaidObserverRefCount - 1)
  if (mermaidObserverRefCount === 0 && mermaidThemeObserver) {
    mermaidThemeObserver.disconnect()
    mermaidThemeObserver = null
  }
}

export const ChatMarkdown = React.memo(function ChatMarkdown(props: Props) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const renderSeqRef = React.useRef(0)
  const deferred = React.useDeferredValue(props.markdown)

  const fastHtml = React.useMemo(() => {
    try {
      const file = fastProcessor.processSync(deferred ?? "")
      return sanitizeHtml(String(file))
    } catch {
      return ""
    }
  }, [deferred])

  const [enhancedHtml, setEnhancedHtml] = React.useState("")
  const [enhancedFor, setEnhancedFor] = React.useState("")

  React.useEffect(() => {
    const src = deferred ?? ""
    if (!src.trim()) {
      setEnhancedHtml("")
      setEnhancedFor(src)
      return
    }

    const cached = getCachedEnhancedHtml(src)
    if (cached !== undefined) {
      setEnhancedHtml(cached)
      setEnhancedFor(src)
      return
    }

    const seq = ++renderSeqRef.current
    let cancelled = false
    void (async () => {
      try {
        const file = await enhancedProcessor.process(src)
        if (cancelled || seq !== renderSeqRef.current) return
        const html = sanitizeHtml(String(file))
        setCachedEnhancedHtml(src, html)
        setEnhancedHtml(html)
        setEnhancedFor(src)
      } catch {
        if (cancelled || seq !== renderSeqRef.current) return
        setEnhancedHtml("")
        setEnhancedFor(src)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [deferred])

  const effectiveHtml = enhancedHtml && enhancedFor === (deferred ?? "") ? enhancedHtml : fastHtml

  React.useEffect(() => {
    acquireMermaidThemeObserver()
    return () => releaseMermaidThemeObserver()
  }, [])

  React.useEffect(() => {
    if (!containerRef.current || !effectiveHtml) return
    bindExpressiveCodeCopy(containerRef.current)
    scheduleMermaidRender()
  }, [effectiveHtml])

  if (!effectiveHtml) {
    return <div className={cn(props.className, "whitespace-pre-wrap break-words")}>{props.markdown}</div>
  }
  return <div ref={containerRef} className={props.className} dangerouslySetInnerHTML={{ __html: effectiveHtml }} />
})
