import crypto from "node:crypto"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { isAdmin, requireRequestAuth } from "@/lib/server/authz"
import { getClientIp } from "@/lib/server/auth/rate-limit"
import { readSmtpConfig } from "@/lib/server/email/email-settings"
import { hashOpaqueToken } from "@/lib/server/auth/token"
import { requestLocale, requestOrigin, sendTemplatedEmailBestEffort } from "@/lib/server/email/send-templated-email"

export const runtime = "nodejs"

export const POST = withApiObservability(async (req: Request, ctx: { params: Promise<{ userId: string }> }) => {
  const auth = requireRequestAuth()
  if (!isAdmin(auth)) return fail({ status: 403, code: "FORBIDDEN" })

  const params = await ctx.params
  const userPublicId = String(params.userId || "").trim()
  if (!userPublicId) return fail({ status: 404, code: "USER_NOT_FOUND" })

  const user = await prisma.user.findUnique({
    where: { publicId: userPublicId },
    select: { id: true, email: true, isDisabled: true },
  })
  if (!user || user.isDisabled) return fail({ status: 404, code: "USER_NOT_FOUND" })

  const token = crypto.randomBytes(32).toString("base64url")
  const tokenHash = hashOpaqueToken(token)
  const now = new Date()
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
  const clientIp = getClientIp(req)

  await prisma.passwordResetToken.create({
    data: {
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash,
      createdAt: now,
      expiresAt,
      usedAt: null,
      ip: clientIp === "unknown" ? null : clientIp,
      userAgent: req.headers.get("user-agent") ?? null,
    },
    select: { id: true },
  })

  const origin = requestOrigin(req)
  const resetPath = `/reset-password?token=${encodeURIComponent(token)}`
  const resetUrl = origin ? `${origin}${resetPath}` : resetPath

  // Best-effort: try to email the user the reset link if SMTP is configured.
  // Keep response stable even if email is not available.
  let emailSent = false
  let emailErrorCode: string | null = null
  {
    const smtp = await readSmtpConfig({ touchPasswordLastUsed: true })
    if (smtp.ok) {
      const locale = requestLocale(req)
      const sent = await sendTemplatedEmailBestEffort({
        smtp,
        to: user.email,
        key: "ADMIN_PASSWORD_RESET_LINK",
        locale,
        vars: { appName: "Maia", email: user.email, resetUrl, expiresIn: "1 hour" },
      })
      emailSent = sent.emailSent
      emailErrorCode = sent.emailSent ? null : sent.emailErrorCode
    } else {
      emailErrorCode = smtp.code
    }
  }

  return ok({ ok: true, resetUrl, expiresAt: expiresAt.toISOString(), emailSent, emailErrorCode })
})
