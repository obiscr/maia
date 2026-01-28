import crypto from "node:crypto"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { allocatePublicId } from "@/lib/server/public-ids"
import { hashPassword } from "@/lib/server/auth/password"
import { createSession, cookieHeaderForSession, getSessionCookieSecure } from "@/lib/server/auth/session"
import { checkRateLimit, getClientIp, RATE_LIMIT_CONFIG } from "@/lib/server/auth/rate-limit"
import { getRegistrationMode, getInstallation } from "@/lib/server/installation"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(256),
  name: z.string().trim().max(200).optional(),
})

// POST /api/auth/signup
export const POST = withApiObservability(async (req: Request) => {
  const clientIp = getClientIp(req)
  {
    const rl = checkRateLimit({
      key: `auth:signup:ip:${clientIp}`,
      limit: RATE_LIMIT_CONFIG.authSignupPerIpLimit,
      windowMs: RATE_LIMIT_CONFIG.authSignupWindowMs,
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

  const installed = await getInstallation()
    .then((i) => Boolean(i?.installedAt))
    .catch(() => false)
  if (!installed) return fail({ status: 409, code: "NOT_INSTALLED" })

  const mode = await getRegistrationMode().catch(() => "DISABLED" as const)
  if (mode !== "OPEN") return fail({ status: 403, code: "REGISTRATION_DISABLED", meta: { mode } })

  let body: z.infer<typeof schema>
  try {
    body = schema.parse(await req.json())
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const email = body.email.toLowerCase()
  // Product contract: return stable error codes (UI localizes).
  if (String(body.password ?? "").length < 8) return fail({ status: 422, code: "PASSWORD_TOO_SHORT", meta: { min: 8 } })
  const passwordHash = hashPassword(body.password)

  const created = await prisma.$transaction(async (tx) => {
    const exists = await tx.user.findUnique({ where: { email }, select: { id: true } })
    if (exists) return null
    const pub = await allocatePublicId(tx, "user")
    const user = await tx.user.create({
      data: {
        id: crypto.randomUUID(),
        publicId: pub.publicId,
        publicNumber: pub.publicNumber,
        email,
        name: body.name?.trim() ? body.name.trim() : null,
        role: "MEMBER",
        isDisabled: false,
        passwordHash,
        totpEnabled: false,
        totpSecret: null,
        totpVerifiedAt: null,
      },
      select: { id: true, publicId: true, email: true, role: true, totpEnabled: true },
    })
    return user
  })

  if (!created) return fail({ status: 409, code: "EMAIL_TAKEN" })

  const ip = clientIp === "unknown" ? null : clientIp
  const ua = req.headers.get("user-agent") ?? null
  const sess = await createSession({ userId: created.id, ip, userAgent: ua })

  return ok(
    {
      ok: true,
      user: {
        id: created.publicId,
        publicId: created.publicId,
        email: created.email,
        role: created.role,
        totpEnabled: created.totpEnabled,
      },
    },
    {
      status: 201,
      headers: {
        "Set-Cookie": cookieHeaderForSession(sess.token, {
          expiresAt: sess.expiresAt,
          secure: getSessionCookieSecure(req),
        }),
      },
    },
  )
})
