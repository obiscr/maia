import nodemailer from "nodemailer"
import { z } from "zod"

import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { prisma } from "@/lib/server/db"
import { SYSTEM_SECRET_KEYS, getSystemSecretPlaintext } from "@/lib/server/settings/system-secrets"
import { renderSmtpTestEmail } from "@/lib/server/email/templates"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const schema = z.object({
  toEmail: z.string().trim().email(),
})

export const POST = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })
  if (String(user.role) !== "ADMIN") return fail({ status: 403, code: "FORBIDDEN" })

  let body: z.infer<typeof schema>
  try {
    body = schema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const inst = await prisma.installation.findUnique({
    where: { id: "installation" },
    select: {
      smtpEnabled: true,
      smtpHost: true,
      smtpPort: true,
      smtpSecure: true,
      smtpUsername: true,
      smtpFromEmail: true,
      smtpFromName: true,
    },
  })
  if (!inst) return fail({ status: 409, code: "NOT_INSTALLED" })
  if (!inst.smtpEnabled) return fail({ status: 409, code: "SMTP_DISABLED" })

  const host = String(inst.smtpHost ?? "").trim()
  const port = typeof inst.smtpPort === "number" ? inst.smtpPort : null
  const secure = Boolean(inst.smtpSecure)
  const username = String(inst.smtpUsername ?? "").trim()
  const fromEmail = String(inst.smtpFromEmail ?? "").trim() || username
  const fromName = String(inst.smtpFromName ?? "").trim() || "Maia"

  if (!host || !port) return fail({ status: 422, code: "SMTP_INCOMPLETE" })

  const password = await getSystemSecretPlaintext({ key: SYSTEM_SECRET_KEYS.smtpPassword, touchLastUsed: true }).catch(
    () => null,
  )
  if (!password) return fail({ status: 422, code: "SMTP_PASSWORD_MISSING" })

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: username ? { user: username, pass: password } : undefined,
  })

  const msg = renderSmtpTestEmail({ appName: "Maia" })

  const info = await transporter.sendMail({
    from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
    to: body.toEmail,
    subject: msg.subject,
    text: msg.text,
  })

  return ok({ ok: true, messageId: typeof info.messageId === "string" ? info.messageId : String(info.messageId ?? "") })
})
