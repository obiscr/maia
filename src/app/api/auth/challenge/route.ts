import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { consumeTotpSigninChallenge } from "@/lib/server/auth/challenge"
import { verifyTotp } from "@/lib/server/auth/totp"
import { createSession, cookieHeaderForSession, getSessionCookieSecure } from "@/lib/server/auth/session"
import { checkRateLimit, getClientIp, RATE_LIMIT_CONFIG } from "@/lib/server/auth/rate-limit"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const schema = z.object({
  challengeId: z.string().trim().min(1),
  code: z.string().trim().min(1).max(16),
})

// POST /api/auth/challenge
export const POST = withApiObservability(async (req: Request) => {
  const clientIp = getClientIp(req)
  {
    const rl = checkRateLimit({
      key: `auth:challenge:ip:${clientIp}`,
      limit: RATE_LIMIT_CONFIG.authChallengePerIpLimit,
      windowMs: RATE_LIMIT_CONFIG.authChallengeWindowMs,
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
    body = schema.parse(await req.json())
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const consumed = await consumeTotpSigninChallenge(body.challengeId)
  // The challenge is an application-level one-time token, not an auth session.
  // If it's missing/expired/used, that's not "401 unauthorized".
  if (!consumed) return fail({ status: 410, code: "CHALLENGE_INVALID" })

  const user = await prisma.user.findUnique({
    where: { id: consumed.userId },
    select: {
      id: true,
      publicId: true,
      email: true,
      name: true,
      role: true,
      isDisabled: true,
      totpEnabled: true,
      totpSecret: true,
    },
  })
  if (!user || user.isDisabled) return fail({ status: 401, code: "UNAUTHORIZED" })
  if (!user.totpEnabled) return fail({ status: 409, code: "TOTP_NOT_ENABLED" })
  const secret = user.totpSecret
  if (!secret) return fail({ status: 409, code: "TOTP_NOT_SETUP" })

  const okTotp = verifyTotp({ secretBase32: secret, code: body.code, window: 1 })
  // Bad verification code is a validation error, not an auth session failure.
  if (!okTotp) return fail({ status: 422, code: "TOTP_INVALID" })

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
