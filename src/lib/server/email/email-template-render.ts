import "server-only"

import type { EmailTemplateKey } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { renderTemplateString } from "@/lib/shared/email/template-string"

export type RenderedEmailTemplate = {
  subject: string
  html: string
  text: string | null
}

function htmlToText(html: string): string {
  // Keep this intentionally simple (no dependency). It's good enough as a fallback.
  return String(html ?? "")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
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
