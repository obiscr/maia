import crypto from "node:crypto"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { isAdmin, requireRequestAuth } from "@/lib/server/authz"
import { getClientIp } from "@/lib/server/auth/rate-limit"
import { readSmtpConfig } from "@/lib/server/email/email-settings"
import { hashOpaqueToken, newOpaqueToken } from "@/lib/server/auth/token"
import { requestLocale, requestOrigin, sendTemplatedEmailBestEffort } from "@/lib/server/email/send-templated-email"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const schema = z.object({
  email: z.string().trim().email(),
})

const getQuerySchema = z.object({
  email: z.string().trim().email(),
})

// GET /api/admin/users/invite?email=...
export const GET = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  if (!isAdmin(auth)) return fail({ status: 403, code: "FORBIDDEN" })

  const url = new URL(req.url)
  let qp: z.infer<typeof getQuerySchema>
  try {
    qp = getQuerySchema.parse({ email: url.searchParams.get("email") ?? "" })
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_QUERY", issues: zodIssues(e) })
    throw e
  }

  const email = qp.email.toLowerCase()
  const now = new Date()

  const invites = await prisma.signupInviteToken.findMany({
    where: { email, usedAt: null, invalidatedAt: null, revokedAt: null, expiresAt: { gt: now } },
    orderBy: [{ createdAt: "desc" }],
    take: 20,
    select: {
      id: true,
      email: true,
      createdAt: true,
      expiresAt: true,
      invitedByUser: { select: { publicId: true, email: true } },
    },
  })

  return ok({
    ok: true,
    email,
    invites: invites.map((r) => ({
      id: r.id,
      email: r.email,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      invitedBy: r.invitedByUser ? { publicId: r.invitedByUser.publicId, email: r.invitedByUser.email } : null,
    })),
  })
})

// POST /api/admin/users/invite
export const POST = withApiObservability(async (req: Request) => {
  const auth = requireRequestAuth()
  if (!isAdmin(auth)) return fail({ status: 403, code: "FORBIDDEN" })

  let body: z.infer<typeof schema>
  try {
    body = schema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const email = body.email.toLowerCase()
  const token = newOpaqueToken()
  const tokenHash = hashOpaqueToken(token)
  const now = new Date()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const clientIp = getClientIp(req)

  // Invalidate any previously issued invites for this email (best-effort; keep latest link canonical).
  const inviteRow = await prisma.$transaction(async (tx) => {
    await tx.signupInviteToken.updateMany({
      where: { email, usedAt: null, invalidatedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { invalidatedAt: now },
    })
    return await tx.signupInviteToken.create({
      data: {
        id: crypto.randomUUID(),
        tokenHash,
        email,
        invitedByUserId: auth.userId,
        createdAt: now,
        expiresAt,
        invalidatedAt: null,
        revokedAt: null,
        usedAt: null,
        ip: clientIp === "unknown" ? null : clientIp,
        userAgent: req.headers.get("user-agent") ?? null,
      },
      select: { id: true, email: true, expiresAt: true },
    })
  })

  const origin = requestOrigin(req)
  const invitePath = `/signup?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`
  const inviteUrl = origin ? `${origin}${invitePath}` : invitePath

  // Best-effort send: keep response useful even if SMTP is not configured.
  let emailSent = false
  let emailErrorCode: string | null = null
  {
    const smtp = await readSmtpConfig({ touchPasswordLastUsed: true })
    if (smtp.ok) {
      const locale = requestLocale(req)
      const sent = await sendTemplatedEmailBestEffort({
        smtp,
        to: email,
        key: "SIGNUP_INVITE",
        locale,
        vars: { appName: "Maia", inviteUrl, expiresIn: "7 days" },
      })
      emailSent = sent.emailSent
      emailErrorCode = sent.emailSent ? null : sent.emailErrorCode
    } else {
      emailErrorCode = smtp.code
    }
  }

  return ok({
    ok: true,
    invite: { id: inviteRow.id, email: inviteRow.email, inviteUrl, expiresAt: inviteRow.expiresAt.toISOString() },
    emailSent,
    emailErrorCode,
  })
})
