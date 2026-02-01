import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { createSession, cookieHeaderForSession, getSessionCookieSecure } from "@/lib/server/auth/session"
import { createTotpSigninChallenge } from "@/lib/server/auth/challenge"
import { getClientIp } from "@/lib/server/auth/rate-limit"
import { hashOpaqueToken } from "@/lib/server/auth/token"
import { getTotpSecretBase32ForUser } from "@/lib/server/auth/totp-secret"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const schema = z.object({
  token: z.string().trim().min(1).max(4096),
})

// POST /api/auth/magic/consume
export const POST = withApiObservability(async (req: Request) => {
  let body: z.infer<typeof schema>
  try {
    body = schema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const tokenHash = hashOpaqueToken(body.token)
  const now = new Date()
  const row = await prisma.authMagicLinkToken
    .findUnique({ where: { tokenHash }, select: { id: true, userId: true, expiresAt: true, usedAt: true } })
    .catch(() => null)
  if (!row) return fail({ status: 422, code: "TOKEN_INVALID" })
  if (row.expiresAt <= now) return fail({ status: 410, code: "TOKEN_EXPIRED" })
  if (row.usedAt) return fail({ status: 422, code: "TOKEN_USED" })

  const user = await prisma.user.findUnique({
    where: { id: row.userId },
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
  if (!user || user.isDisabled) return fail({ status: 404, code: "USER_NOT_FOUND" })

  // Consume token (one-time).
  const updated = await prisma.authMagicLinkToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: now },
  })
  if (updated.count !== 1) return fail({ status: 409, code: "TOKEN_RACE" })

  const clientIp = getClientIp(req)
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
