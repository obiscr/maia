import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { verifyPassword } from "@/lib/server/auth/password"
import { createSession, cookieHeaderForSession, getSessionCookieSecure } from "@/lib/server/auth/session"
import { createTotpSigninChallenge } from "@/lib/server/auth/challenge"
import { getTotpSecretBase32ForUser } from "@/lib/server/auth/totp-secret"
import { checkRateLimit, getClientIp, RATE_LIMIT_CONFIG } from "@/lib/server/auth/rate-limit"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(256),
})

// POST /api/auth/signin
export const POST = withApiObservability(async (req: Request) => {
  const clientIp = getClientIp(req)

  let body: z.infer<typeof schema>
  try {
    body = schema.parse(await req.json())
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const email = body.email.toLowerCase()

  // Minimal brute-force protection (in-memory; local-first friendly).
  // This is not meant to be a global WAF; it just prevents accidental public exposure disasters.
  {
    const perIp = checkRateLimit({
      key: `auth:signin:ip:${clientIp}`,
      limit: RATE_LIMIT_CONFIG.authSigninPerIpLimit,
      windowMs: RATE_LIMIT_CONFIG.authSigninWindowMs,
    })
    if (!perIp.allowed) {
      const retryAfterSeconds = Math.ceil(perIp.retryAfterMs / 1000)
      return fail({
        status: 429,
        code: "RATE_LIMITED",
        meta: { retryAfterSeconds },
        headers: { "Retry-After": String(retryAfterSeconds) },
      })
    }
    const perIpEmail = checkRateLimit({
      key: `auth:signin:ip_email:${clientIp}:${email}`,
      limit: RATE_LIMIT_CONFIG.authSigninPerIpEmailLimit,
      windowMs: RATE_LIMIT_CONFIG.authSigninWindowMs,
    })
    if (!perIpEmail.allowed) {
      const retryAfterSeconds = Math.ceil(perIpEmail.retryAfterMs / 1000)
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
      passwordHash: true,
      totpEnabled: true,
    },
  })
  if (!user || user.isDisabled) return fail({ status: 401, code: "INVALID_CREDENTIALS" })
  if (!verifyPassword(body.password, user.passwordHash)) return fail({ status: 401, code: "INVALID_CREDENTIALS" })

  // If TOTP is enabled, we don't complete the session here.
  // Instead we issue a short-lived, one-time challenge token and ask the client to finish on /otp.
  if (user.totpEnabled) {
    const secret = await getTotpSecretBase32ForUser(user.id)
    if (!secret) return fail({ status: 409, code: "TOTP_NOT_SETUP" })

    const ip = clientIp === "unknown" ? null : clientIp
    const ua = req.headers.get("user-agent") ?? null
    const chall = await createTotpSigninChallenge({ userId: user.id, ip, userAgent: ua })
    return fail({
      // Auth flow continuation: the password is correct, but the session is not established yet.
      // Use 409 so clients don't treat it as "logged out / expired session".
      status: 409,
      code: "TOTP_REQUIRED",
      meta: { challengeId: chall.challengeId, expiresAt: chall.expiresAt.toISOString() },
    })
  }

  const ip = clientIp === "unknown" ? null : clientIp
  const ua = req.headers.get("user-agent") ?? null
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
