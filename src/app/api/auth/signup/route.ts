import crypto from "node:crypto"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { allocatePublicId } from "@/lib/server/public-ids"
import { hashPassword } from "@/lib/server/auth/password"
import { createSession, cookieHeaderForSession, getSessionCookieSecure } from "@/lib/server/auth/session"
import { checkRateLimit, getClientIp, RATE_LIMIT_CONFIG } from "@/lib/server/auth/rate-limit"
import { readSmtpConfig } from "@/lib/server/email/email-settings"
import { issueOpaqueEmailToken, revokeOpaqueEmailTokenBestEffort } from "@/lib/server/auth/email-token-flow"
import { hashOpaqueToken } from "@/lib/server/auth/token"
import { requestLocale, requestOrigin, sendTemplatedEmailBestEffort } from "@/lib/server/email/send-templated-email"
import { getRegistrationMode, getInstallation } from "@/lib/server/installation"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const schema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(256),
  name: z.string().trim().max(200).optional(),
  inviteToken: z.string().trim().min(1).max(2048).optional(),
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

  let body: z.infer<typeof schema>
  try {
    body = schema.parse(await req.json())
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const mode = await getRegistrationMode().catch(() => "DISABLED" as const)

  const email = body.email.toLowerCase()
  const inviteToken = String(body.inviteToken ?? "").trim()

  // Registration gating:
  // - OPEN: allow normal signup
  // - INVITE_ONLY: require invite
  // - DISABLED: block public signup, but allow invite-based signup as an admin-controlled path
  if (mode === "DISABLED" && !inviteToken) return fail({ status: 403, code: "REGISTRATION_DISABLED", meta: { mode } })
  const effectiveMode = mode === "DISABLED" ? ("INVITE_ONLY" as const) : mode

  // Product contract: return stable error codes (UI localizes).
  if (String(body.password ?? "").length < 8) return fail({ status: 422, code: "PASSWORD_TOO_SHORT", meta: { min: 8 } })
  const passwordHash = hashPassword(body.password)

  const now = new Date()

  const created = await prisma.$transaction(async (tx) => {
    const invite =
      inviteToken.length > 0
        ? await tx.signupInviteToken.findUnique({
            where: { tokenHash: hashOpaqueToken(inviteToken) },
            select: { id: true, email: true, usedAt: true, invalidatedAt: true, revokedAt: true, expiresAt: true },
          })
        : null

    if (effectiveMode === "INVITE_ONLY" && !inviteToken)
      return { kind: "error" as const, status: 403, code: "INVITE_REQUIRED" }
    if (inviteToken && !invite) return { kind: "error" as const, status: 403, code: "INVITE_INVALID" }
    if (invite && invite.invalidatedAt) return { kind: "error" as const, status: 403, code: "INVITE_INVALIDATED" }
    if (invite && invite.revokedAt) return { kind: "error" as const, status: 403, code: "INVITE_REVOKED" }
    if (invite && invite.usedAt) return { kind: "error" as const, status: 403, code: "INVITE_USED" }
    if (invite && invite.expiresAt <= now) return { kind: "error" as const, status: 403, code: "INVITE_EXPIRED" }
    if (invite && String(invite.email ?? "").toLowerCase() !== email)
      return { kind: "error" as const, status: 403, code: "INVITE_EMAIL_MISMATCH" }

    const exists = await tx.user.findUnique({ where: { email }, select: { id: true } })
    if (exists) return { kind: "error" as const, status: 409, code: "EMAIL_TAKEN" }

    const pub = await allocatePublicId(tx, "user")
    const user = await tx.user.create({
      data: {
        id: crypto.randomUUID(),
        publicId: pub.publicId,
        publicNumber: pub.publicNumber,
        email,
        emailVerifiedAt: invite ? now : null,
        name: body.name?.trim() ? body.name.trim() : null,
        role: "MEMBER",
        isDisabled: false,
        passwordHash,
        totpEnabled: false,
        totpSecret: null,
        totpVerifiedAt: null,
      },
      select: { id: true, publicId: true, email: true, emailVerifiedAt: true, role: true, totpEnabled: true },
    })

    if (invite?.id) {
      await tx.signupInviteToken.update({ where: { id: invite.id }, data: { usedAt: now } }).catch(() => {})
    }

    return { kind: "ok" as const, user }
  })

  if (!created) return fail({ status: 500, code: "SIGNUP_FAILED" })
  if (created.kind === "error") return fail({ status: created.status, code: created.code })

  const ip = clientIp === "unknown" ? null : clientIp
  const ua = req.headers.get("user-agent") ?? null
  const sess = await createSession({ userId: created.user.id, ip, userAgent: ua })

  // Best-effort: send signup confirmation email (if not already verified via invite).
  // Keep signup success path stable even if email is not available.
  if (!created.user.emailVerifiedAt) {
    const origin = requestOrigin(req)
    if (origin) {
      const smtp = await readSmtpConfig({ touchPasswordLastUsed: true })
      if (smtp.ok) {
        const locale = requestLocale(req)
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
        const issued = await issueOpaqueEmailToken({
          create: async (tokenHash) => {
            return await prisma.emailVerificationToken.create({
              data: {
                id: crypto.randomUUID(),
                tokenHash,
                userId: created.user.id,
                createdAt: new Date(),
                expiresAt,
                usedAt: null,
                ip,
                userAgent: ua,
              },
              select: { id: true },
            })
          },
        })
        if (!issued.ok) {
          // Best-effort email; do not affect signup success response.
          // Just skip sending if token can't be persisted.
        } else {
          const confirmationUrl = `${origin}/confirm-email?token=${encodeURIComponent(issued.token)}`
          const sent = await sendTemplatedEmailBestEffort({
            smtp,
            to: created.user.email,
            key: "SIGNUP_CONFIRMATION",
            locale,
            vars: { appName: "Maia", confirmationUrl, expiresIn: "1 hour" },
          })
          if (!sent.emailSent) {
            await revokeOpaqueEmailTokenBestEffort({
              tokenRowId: issued.tokenRowId,
              revoke: async (tokenRowId) => {
                return await prisma.emailVerificationToken.delete({ where: { id: tokenRowId } })
              },
            })
          }
        }
      }
    }
  }

  return ok(
    {
      ok: true,
      user: {
        id: created.user.publicId,
        publicId: created.user.publicId,
        email: created.user.email,
        role: created.user.role,
        totpEnabled: created.user.totpEnabled,
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
