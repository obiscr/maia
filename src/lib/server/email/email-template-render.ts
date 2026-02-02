import "server-only"

import type { EmailTemplateKey } from "@prisma/client"
import { convert } from "html-to-text"
import { unified } from "unified"
import rehypeParse from "rehype-parse"
import rehypeStringify from "rehype-stringify"
import { visit } from "unist-util-visit"

import { prisma } from "@/lib/server/db"
import { renderTemplateString } from "@/lib/shared/email/template-string"

export type RenderedEmailTemplate = {
  subject: string
  html: string
  text: string | null
}

function stripEmptyHrefAnchors(html: string): string {
  const input = String(html ?? "")
  if (!input.trim()) return input
  try {
    const processor = unified().use(rehypeParse, { fragment: true })
    const tree = processor.parse(input)

    visit(tree as any, "element", (node: any, index?: number, parent?: any) => {
      if (!parent || typeof index !== "number") return
      if (node?.tagName !== "a") return
      const hrefRaw = node?.properties?.href
      const href = typeof hrefRaw === "string" ? hrefRaw : Array.isArray(hrefRaw) ? String(hrefRaw[0] ?? "") : ""
      if (String(href ?? "").trim() !== "") return

      // Replace <a href="">...</a> with its children (keep readable text; avoid dead links).
      const kids = Array.isArray(node.children) ? node.children : []
      if (Array.isArray(parent.children)) parent.children.splice(index, 1, ...kids)
    })

    return unified()
      .use(rehypeStringify)
      .stringify(tree as any)
  } catch {
    // Best-effort: if parsing fails, keep original HTML.
    return input
  }
}

function htmlToText(html: string): string {
  // Use a mature, well-tested converter instead of regex sanitization.
  // This avoids incomplete sanitization / double-unescaping pitfalls flagged by CodeQL.
  return convert(String(html ?? ""), {
    wordwrap: false,
    preserveNewlines: true,
    selectors: [
      // Keep links readable in plain text.
      { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
      // Avoid duplicating images' alt/src.
      { selector: "img", format: "skip" },
    ],
  }).trim()
}

async function getEmailTemplateRow(params: { key: EmailTemplateKey; locale: string }) {
  const locale = String(params.locale ?? "").trim() || "en"
  const key = params.key
  const row =
    (await prisma.emailTemplate
      .findFirst({
        where: { key, locale },
        select: { key: true, locale: true, subjectTemplate: true, htmlTemplate: true, textTemplate: true },
      })
      .catch(() => null)) ?? null
  if (row) return row
  if (locale !== "en") {
    return (
      (await prisma.emailTemplate
        .findFirst({
          where: { key, locale: "en" },
          select: { key: true, locale: true, subjectTemplate: true, htmlTemplate: true, textTemplate: true },
        })
        .catch(() => null)) ?? null
    )
  }
  return null
}

export async function renderEmailTemplate(params: {
  key: EmailTemplateKey
  locale?: string | null
  vars: Record<string, unknown>
}): Promise<RenderedEmailTemplate | null> {
  const locale = String(params.locale ?? "").trim() || "en"
  const row = await getEmailTemplateRow({ key: params.key, locale })
  if (!row) return null

  const subject = renderTemplateString(row.subjectTemplate, params.vars)
  const renderedHtml = renderTemplateString(row.htmlTemplate, params.vars)
  const renderedText =
    typeof row.textTemplate === "string" && row.textTemplate.trim().length
      ? renderTemplateString(row.textTemplate, params.vars)
      : null

  const html = stripEmptyHrefAnchors(renderedHtml)
  const text = renderedText ?? htmlToText(html)

  return { subject, html, text: text.trim().length ? text : null }
}
