import "server-only"

import type { EmailTemplateKey } from "@prisma/client"
import { convert } from "html-to-text"

import { prisma } from "@/lib/server/db"
import { renderTemplateString } from "@/lib/shared/email/template-string"

export type RenderedEmailTemplate = {
  subject: string
  html: string
  text: string | null
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
  const html = renderTemplateString(row.htmlTemplate, params.vars)
  const text =
    typeof row.textTemplate === "string" && row.textTemplate.trim().length
      ? renderTemplateString(row.textTemplate, params.vars)
      : htmlToText(html)

  return { subject, html, text: text.trim().length ? text : null }
}
