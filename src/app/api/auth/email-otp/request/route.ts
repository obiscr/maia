import crypto from "node:crypto"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { checkRateLimit, getClientIp, RATE_LIMIT_CONFIG } from "@/lib/server/auth/rate-limit"
import { readSmtpConfig } from "@/lib/server/email/email-settings"
import { hashOtpCode, newOtpCode6, newSalt } from "@/lib/server/auth/token"
import { requestLocale, sendTemplatedEmailBestEffort } from "@/lib/server/email/send-templated-email"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const schema = z.object({
  email: z.string().trim().email(),
})

// POST /api/auth/email-otp/request
export const POST = withApiObservability(async (req: Request) => {
  const clientIp = getClientIp(req)
  {
    const rl = checkRateLimit({
      key: `auth:email_otp:request:ip:${clientIp}`,
      limit: RATE_LIMIT_CONFIG.authEmailOtpRequestPerIpLimit,
      windowMs: RATE_LIMIT_CONFIG.authEmailOtpRequestWindowMs,
    })
    if (!rl.allowed) {
      const retryAfterSeconds = Math.ceil(rl.retryAfterMs / 1000)
      return fail({
        status: 429,
        code: "RATE_LIMITED",
        meta: { retryAfterSeconds },
        headers: { "Retry-After": String(retryAfterSeconds) },
      })
    }
  }

  let body: z.infer<typeof schema>
  try {
    body = schema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const email = body.email.toLowerCase()
  {
    const rl = checkRateLimit({
      key: `auth:email_otp:request:ip_email:${clientIp}:${email}`,
      limit: RATE_LIMIT_CONFIG.authEmailOtpRequestPerIpEmailLimit,
      windowMs: RATE_LIMIT_CONFIG.authEmailOtpRequestWindowMs,
    })
    if (!rl.allowed) {
      const retryAfterSeconds = Math.ceil(rl.retryAfterMs / 1000)
      return fail({
        status: 429,
        code: "RATE_LIMITED",
        meta: { retryAfterSeconds },
        headers: { "Retry-After": String(retryAfterSeconds) },
      })
    }
  }

  // Do not reveal whether the email exists.
  const smtp = await readSmtpConfig({ touchPasswordLastUsed: true })
  if (!smtp.ok) return ok({ ok: true })

  const user = await prisma.user
    .findUnique({ where: { email }, select: { id: true, isDisabled: true } })
    .catch(() => null)
  if (!user || user.isDisabled) return ok({ ok: true })

  const now = new Date()
  const code = newOtpCode6()
  const salt = newSalt()
  const codeHash = hashOtpCode({ code, salt })

  const locale = requestLocale(req)
  const sent = await sendTemplatedEmailBestEffort({
    smtp,
    to: email,
    key: "AUTH_EMAIL_OTP",
    locale,
    vars: { appName: "Maia", code, expiresIn: "10 minutes" },
  })

  if (sent.emailSent) {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    await prisma.$transaction(async (tx) => {
      await tx.authEmailOtpToken.updateMany({
        where: { userId: user.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      })
      await tx.authEmailOtpToken.create({
        data: {
          id: crypto.randomUUID(),
          userId: user.id,
          salt,
          codeHash,
          attemptCount: 0,
          maxAttempts: 5,
          createdAt: now,
          expiresAt,
          usedAt: null,
          ip: clientIp === "unknown" ? null : clientIp,
          userAgent: req.headers.get("user-agent") ?? null,
        },
        select: { id: true },
      })
    })
  }

  return ok({ ok: true })
})
