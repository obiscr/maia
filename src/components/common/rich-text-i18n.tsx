"use client"

import * as React from "react"

import { useI18nOptional } from "@/components/i18n-provider"

type RichTag = "strong" | "code" | "br"

type Node = { type: "text"; text: string } | { type: "tag"; tag: RichTag; children: Node[] }

function interpolate(template: string, params?: Record<string, string | number>) {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k]
    return v === undefined || v === null ? `{${k}}` : String(v)
  })
}

function isAllowedTag(tag: string): tag is RichTag {
  return tag === "strong" || tag === "code" || tag === "br"
}

function parseRichText(input: string): Node[] {
  // Very small whitelist parser for tooltip-ish strings.
  // Supports: <strong>..</strong>, <code>..</code>, <br/> (or <br />)
  const tokens = input.split(/(<\/?[\w-]+(?:\s*\/)?>)/g).filter((x) => x.length > 0)

  const root: { tag: "root"; children: Node[] } = { tag: "root", children: [] }
  const stack: Array<{ tag: "root" | RichTag; children: Node[] }> = [root]

  function pushText(text: string) {
    if (!text) return
    stack[stack.length - 1]!.children.push({ type: "text", text })
  }

  for (const tok of tokens) {
    if (!tok.startsWith("<") || !tok.endsWith(">")) {
      pushText(tok)
      continue
    }

    // Normalize whitespace inside tag
    const inner = tok.slice(1, -1).trim()
    const isClosing = inner.startsWith("/")
    const isSelfClosing = inner.endsWith("/") || inner === "br" || inner === "br/"

    // Extract tag name, drop any attributes, and normalize trailing "/" for self-closing tags.
    let nameRaw = (isClosing ? inner.slice(1) : inner).trim()
    nameRaw = nameRaw.replace(/\s.*$/, "") // drop attributes if any
    if (nameRaw.endsWith("/")) nameRaw = nameRaw.slice(0, -1).trim()
    const name = nameRaw

    if (!isAllowedTag(name)) {
      // Unknown tags are treated as plain text (no HTML rendering).
      pushText(tok)
      continue
    }

    if (name === "br" || isSelfClosing) {
      stack[stack.length - 1]!.children.push({ type: "tag", tag: "br", children: [] })
      continue
    }

    if (!isClosing) {
      const node: { type: "tag"; tag: RichTag; children: Node[] } = { type: "tag", tag: name, children: [] }
      stack[stack.length - 1]!.children.push(node)
      stack.push(node)
      continue
    }

    // Closing tag: unwind to matching tag (best-effort).
    for (let i = stack.length - 1; i >= 1; i--) {
      if (stack[i]!.tag === name) {
        stack.length = i // pop the matched node
        break
      }
    }
  }

  return root.children
}

function renderNodes(nodes: Node[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((n, idx) => {
    const k = `${keyPrefix}-${idx}`
    if (n.type === "text") return <React.Fragment key={k}>{n.text}</React.Fragment>
    if (n.tag === "br") return <br key={k} />
    if (n.tag === "strong") return <strong key={k}>{renderNodes(n.children, k)}</strong>
    // code
    return (
      <code key={k} className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground/90">
        {renderNodes(n.children, k)}
      </code>
    )
  })
}

/**
 * RichTextI18n
 *
 * - Coexists with existing `t()` (plain strings).
 * - Only supports a small whitelist of tags: <strong>, <code>, <br/>.
 * - Unknown tags are rendered as plain text (no HTML).
 */
export function RichTextI18n(props: {
  i18nKey: string
  params?: Record<string, string | number>
  fallback?: React.ReactNode
}) {
  const ctx = useI18nOptional()
  if (!ctx) return <>{props.fallback ?? props.i18nKey}</>
  const raw = ctx.t(props.i18nKey, props.params)
  const rendered = React.useMemo(() => {
    const interpolated = interpolate(String(raw ?? ""), props.params)
    const ast = parseRichText(interpolated)
    return renderNodes(ast, props.i18nKey)
  }, [props.i18nKey, props.params, raw])

  return <>{rendered}</>
}
