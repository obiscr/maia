import { z } from "zod"
import crypto from "node:crypto"
import { EmailTemplateKey } from "@prisma/client"

import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { zodIssues } from "@/lib/shared/http/zod"
import { formatHtmlTemplate } from "@/lib/shared/email/html-format"

export const runtime = "nodejs"

function requireAdmin(user: { role: string }) {
  if (String(user.role) !== "ADMIN") return false
  return true
}

const localeSchema = z.string().trim().min(1)

const keySchema = z.nativeEnum(EmailTemplateKey)

const updateSchema = z.object({
  key: keySchema,
  locale: localeSchema,
  subjectTemplate: z.string(),
  htmlTemplate: z.string(),
  textTemplate: z.union([z.string(), z.null()]).optional(),
  schemaJson: z.union([z.string(), z.null()]).optional(),
})

export const GET = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })
  if (!requireAdmin(user)) return fail({ status: 403, code: "FORBIDDEN" })

  const rows = await prisma.emailTemplate.findMany({
    orderBy: [{ key: "asc" }, { locale: "asc" }],
    select: {
      id: true,
      key: true,
      locale: true,
      subjectTemplate: true,
      htmlTemplate: true,
      textTemplate: true,
      schemaJson: true,
      version: true,
      updatedAt: true,
    },
  })

  return ok({ templates: rows })
})

export const PUT = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })
  if (!requireAdmin(user)) return fail({ status: 403, code: "FORBIDDEN" })

  let body: z.infer<typeof updateSchema>
  try {
    body = updateSchema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const key = body.key
  const locale = String(body.locale ?? "").trim()
  const subjectTemplate = String(body.subjectTemplate ?? "")
  const htmlTemplateRaw = String(body.htmlTemplate ?? "")
  const htmlTemplate = formatHtmlTemplate(htmlTemplateRaw)
  const textTemplate =
    body.textTemplate === undefined ? undefined : body.textTemplate === null ? null : String(body.textTemplate ?? "")
  const schemaJson =
    body.schemaJson === undefined ? undefined : body.schemaJson === null ? null : String(body.schemaJson ?? "")

  if (!subjectTemplate.trim().length) return fail({ status: 422, code: "SUBJECT_REQUIRED" })
  if (!htmlTemplate.trim().length) return fail({ status: 422, code: "HTML_REQUIRED" })

  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.emailTemplate.findFirst({ where: { key, locale }, select: { id: true } })
    if (existing?.id) {
      return await tx.emailTemplate.update({
        where: { id: existing.id },
        data: {
          subjectTemplate,
          htmlTemplate,
          textTemplate: textTemplate === undefined ? undefined : textTemplate,
          schemaJson: schemaJson === undefined ? undefined : (schemaJson ?? "{}"),
        },
        select: {
          id: true,
          key: true,
          locale: true,
          subjectTemplate: true,
          htmlTemplate: true,
          textTemplate: true,
          schemaJson: true,
          version: true,
          updatedAt: true,
        },
      })
    }

    const id = `email_template:${key}:${locale}`.slice(0, 191)
    return await tx.emailTemplate.create({
      data: {
        id: id || crypto.randomUUID(),
        key,
        locale,
        subjectTemplate,
        htmlTemplate,
        textTemplate: textTemplate === undefined ? null : textTemplate,
        schemaJson: schemaJson === undefined ? "{}" : (schemaJson ?? "{}"),
        version: 1,
      },
      select: {
        id: true,
        key: true,
        locale: true,
        subjectTemplate: true,
        htmlTemplate: true,
        textTemplate: true,
        schemaJson: true,
        version: true,
        updatedAt: true,
      },
    })
  })

  return ok({ template: updated })
})
