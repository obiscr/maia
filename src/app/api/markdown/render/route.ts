import { NextResponse } from "next/server"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkRehype from "remark-rehype"
import rehypeStringify from "rehype-stringify"
import rehypeHighlight from "rehype-highlight"
import type { Options as RehypeHighlightOptions } from "rehype-highlight"
import { visit } from "unist-util-visit"

import { mark, withApiObservability } from "@/lib/server/observability"
import { fail } from "@/lib/server/http/response"

export const runtime = "nodejs"

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

export const POST = withApiObservability(async (req: Request) => {
  const body = await req.json().catch(() => ({}))
  const markdown = String(body?.markdown ?? "")

  try {
    const highlightOptions: RehypeHighlightOptions = { detect: false }
    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(stripRawHtml)
      .use(remarkRehype, { allowDangerousHtml: false })
      .use(rehypeHighlight, highlightOptions)
      .use(stripJavascriptHrefs)
      .use(rehypeStringify)

    const file = await processor.process(markdown)
    mark("render")
    return NextResponse.json({ ok: true, html: String(file) })
  } catch (e) {
    return fail({ status: 500, code: "MARKDOWN_RENDER_FAILED" })
  }
})
