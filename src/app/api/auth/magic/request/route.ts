import crypto from "node:crypto"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { checkRateLimit, getClientIp, RATE_LIMIT_CONFIG } from "@/lib/server/auth/rate-limit"
import { readSmtpConfig } from "@/lib/server/email/email-settings"
import { issueOpaqueEmailToken, revokeOpaqueEmailTokenBestEffort } from "@/lib/server/auth/email-token-flow"
import { preferredPublicBaseUrl, sendTemplatedEmailBestEffort } from "@/lib/server/email/send-templated-email"
import { getOutboundLocaleForUser } from "@/lib/server/settings/outbound-language-settings"
import { joinPublicBaseUrl } from "@/lib/shared/http/public-base-url"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const schema = z.object({
  email: z.string().trim().email(),
})

// POST /api/auth/magic/request
export const POST = withApiObservability(async (req: Request) => {
  const clientIp = getClientIp(req)
  {
    const rl = checkRateLimit({
      key: `auth:magic:request:ip:${clientIp}`,
      limit: RATE_LIMIT_CONFIG.authMagicLinkRequestPerIpLimit,
      windowMs: RATE_LIMIT_CONFIG.authMagicLinkRequestWindowMs,
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
      key: `auth:magic:request:ip_email:${clientIp}:${email}`,
      limit: RATE_LIMIT_CONFIG.authMagicLinkRequestPerIpEmailLimit,
      windowMs: RATE_LIMIT_CONFIG.authMagicLinkRequestWindowMs,
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

  const origin = await preferredPublicBaseUrl(req)
  if (!origin) {
    console.warn(`[email] skipped magic link email (missing Public Base URL): email=${email}`)
    return ok({ ok: true })
  }

  const user = await prisma.user
    .findUnique({ where: { email }, select: { id: true, isDisabled: true } })
    .catch(() => null)
  if (!user || user.isDisabled) return ok({ ok: true })

  const now = new Date()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

  const issued = await issueOpaqueEmailToken({
    create: async (tokenHash) => {
      return await prisma.authMagicLinkToken.create({
        data: {
          id: crypto.randomUUID(),
          tokenHash,
          userId: user.id,
          createdAt: now,
          expiresAt,
          usedAt: null,
          ip: clientIp === "unknown" ? null : clientIp,
          userAgent: req.headers.get("user-agent") ?? null,
        },
        select: { id: true },
      })
    },
  })
  if (!issued.ok) return ok({ ok: true })

  const magicPath = `/auth/magic?token=${encodeURIComponent(issued.token)}`
  const magicLinkUrl = joinPublicBaseUrl(origin, magicPath)
  const locale = await getOutboundLocaleForUser(user.id)
  const sent = await sendTemplatedEmailBestEffort({
    smtp,
    to: email,
    key: "AUTH_MAGIC_LINK",
    locale,
    vars: { appName: "Maia", magicLinkUrl, expiresIn: "10 minutes" },
  })

  if (!sent.emailSent) {
    await revokeOpaqueEmailTokenBestEffort({
      tokenRowId: issued.tokenRowId,
      revoke: async (tokenRowId) => {
        return await prisma.authMagicLinkToken.delete({ where: { id: tokenRowId } })
      },
    })
  }

  return ok({ ok: true })
})
