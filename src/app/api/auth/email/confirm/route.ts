import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { createSession, cookieHeaderForSession, getSessionCookieSecure } from "@/lib/server/auth/session"
import { getClientIp } from "@/lib/server/auth/rate-limit"
import { hashOpaqueToken } from "@/lib/server/auth/token"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const schema = z.object({
  token: z.string().trim().min(1).max(4096),
})

// POST /api/auth/email/confirm
export const POST = withApiObservability(async (req: Request) => {
  let body: z.infer<typeof schema>
  try {
    body = schema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const tokenHash = hashOpaqueToken(body.token)
  const row = await prisma.emailVerificationToken
    .findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    })
    .catch(() => null)
  if (!row) return fail({ status: 422, code: "TOKEN_INVALID" })

  const now = new Date()
  if (row.expiresAt <= now) return fail({ status: 410, code: "TOKEN_EXPIRED" })
  if (row.usedAt) return ok({ ok: true, alreadyConfirmed: true })

  const user = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { id: true, publicId: true, email: true, name: true, role: true, isDisabled: true, totpEnabled: true },
  })
  if (!user || user.isDisabled) return fail({ status: 404, code: "USER_NOT_FOUND" })

  await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.update({ where: { id: row.id }, data: { usedAt: now } })
    await tx.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: now },
      select: { id: true },
    })
  })

  // Confirming email can also establish a session (nice UX for "click link to continue").
  const clientIp = getClientIp(req)
  const ip = clientIp === "unknown" ? null : clientIp
  const ua = req.headers.get("user-agent") ?? null
  const sess = await createSession({ userId: user.id, ip, userAgent: ua })

  return ok(
    {
      ok: true,
      user: { id: user.publicId, publicId: user.publicId, email: user.email, name: user.name ?? null, role: user.role },
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
