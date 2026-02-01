import crypto from "node:crypto"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { createSession, cookieHeaderForSession, getSessionCookieSecure } from "@/lib/server/auth/session"
import { createTotpSigninChallenge } from "@/lib/server/auth/challenge"
import { checkRateLimit, getClientIp, RATE_LIMIT_CONFIG } from "@/lib/server/auth/rate-limit"
import { hashOtpCode } from "@/lib/server/auth/token"
import { getTotpSecretBase32ForUser } from "@/lib/server/auth/totp-secret"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const schema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().min(4).max(12),
})

// POST /api/auth/email-otp/verify
export const POST = withApiObservability(async (req: Request) => {
  const clientIp = getClientIp(req)
  {
    const rl = checkRateLimit({
      key: `auth:email_otp:verify:ip:${clientIp}`,
      limit: RATE_LIMIT_CONFIG.authEmailOtpVerifyPerIpLimit,
      windowMs: RATE_LIMIT_CONFIG.authEmailOtpVerifyWindowMs,
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
      key: `auth:email_otp:verify:ip_email:${clientIp}:${email}`,
      limit: RATE_LIMIT_CONFIG.authEmailOtpVerifyPerIpEmailLimit,
      windowMs: RATE_LIMIT_CONFIG.authEmailOtpVerifyWindowMs,
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

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      publicId: true,
      email: true,
      name: true,
      role: true,
      isDisabled: true,
      totpEnabled: true,
    },
  })
  if (!user || user.isDisabled) return fail({ status: 401, code: "INVALID_CREDENTIALS" })

  const now = new Date()
  const tokenRow = await prisma.authEmailOtpToken.findFirst({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { id: true, salt: true, codeHash: true, attemptCount: true, maxAttempts: true, expiresAt: true },
  })
  if (!tokenRow) return fail({ status: 422, code: "OTP_REQUIRED" })

  if (tokenRow.attemptCount >= tokenRow.maxAttempts) return fail({ status: 429, code: "OTP_TOO_MANY_ATTEMPTS" })

  const providedHash = hashOtpCode({ code: String(body.code ?? "").trim(), salt: tokenRow.salt })
  if (providedHash !== tokenRow.codeHash) {
    const nextAttemptCount = tokenRow.attemptCount + 1
    await prisma.authEmailOtpToken
      .update({
        where: { id: tokenRow.id },
        data: { attemptCount: nextAttemptCount, usedAt: nextAttemptCount >= tokenRow.maxAttempts ? now : undefined },
        select: { id: true },
      })
      .catch(() => {})
    return fail({ status: 422, code: "OTP_INVALID" })
  }

  // Consume OTP token.
  const updated = await prisma.authEmailOtpToken.updateMany({
    where: { id: tokenRow.id, usedAt: null },
    data: { usedAt: now },
  })
  if (updated.count !== 1) return fail({ status: 409, code: "OTP_RACE" })

  const ip = clientIp === "unknown" ? null : clientIp
  const ua = req.headers.get("user-agent") ?? null

  if (user.totpEnabled) {
    const secret = await getTotpSecretBase32ForUser(user.id)
    if (!secret) return fail({ status: 409, code: "TOTP_NOT_SETUP" })
    const chall = await createTotpSigninChallenge({ userId: user.id, ip, userAgent: ua })
    return fail({
      status: 409,
      code: "TOTP_REQUIRED",
      meta: { challengeId: chall.challengeId, expiresAt: chall.expiresAt.toISOString() },
    })
  }

  const sess = await createSession({ userId: user.id, ip, userAgent: ua })
  return ok(
    {
      ok: true,
      user: {
        id: user.publicId,
        publicId: user.publicId,
        email: user.email,
        name: user.name ?? null,
        role: user.role,
        totpEnabled: user.totpEnabled,
      },
    },
    {
      headers: {
        "Set-Cookie": cookieHeaderForSession(sess.token, {
          expiresAt: sess.expiresAt,
          secure: getSessionCookieSecure(req),
        }),
      },
    },
  )
})
