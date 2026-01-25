import crypto from "node:crypto"
import nodemailer from "nodemailer"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { checkRateLimit, getClientIp, RATE_LIMIT_CONFIG } from "@/lib/server/auth/rate-limit"
import { SYSTEM_SECRET_KEYS, getSystemSecretPlaintext } from "@/lib/server/settings/system-secrets"
import { renderPasswordResetEmail } from "@/lib/server/email/templates"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const schema = z.object({
  email: z.string().trim().email(),
})

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex")
}

function requestOrigin(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") ?? "http"
  const host = req.headers.get("host")
  if (!host) return null
  return `${proto}://${host}`
}

async function readSmtpConfig() {
  const inst = await prisma.installation.findUnique({
    where: { id: "installation" },
    select: {
      smtpEnabled: true,
      smtpHost: true,
      smtpPort: true,
      smtpSecure: true,
      smtpUsername: true,
      smtpFromEmail: true,
      smtpFromName: true,
    },
  })
  if (!inst) return { ok: false as const, code: "NOT_INSTALLED" as const }
  if (!inst.smtpEnabled) return { ok: false as const, code: "SMTP_DISABLED" as const }

  const host = String(inst.smtpHost ?? "").trim()
  const port = typeof inst.smtpPort === "number" ? inst.smtpPort : null
  const secure = Boolean(inst.smtpSecure)
  const username = String(inst.smtpUsername ?? "").trim()
  const fromEmail = String(inst.smtpFromEmail ?? "").trim() || username
  const fromName = String(inst.smtpFromName ?? "").trim() || "Maia"

  if (!host || !port) return { ok: false as const, code: "SMTP_INCOMPLETE" as const }

  const password = await getSystemSecretPlaintext({ key: SYSTEM_SECRET_KEYS.smtpPassword, touchLastUsed: true }).catch(
    () => null,
  )
  if (!password) return { ok: false as const, code: "SMTP_PASSWORD_MISSING" as const }

  return { ok: true as const, host, port, secure, username, password, fromEmail, fromName }
}

// POST /api/auth/password/forgot
export const POST = withApiObservability(async (req: Request) => {
  const clientIp = getClientIp(req)
  {
    const rl = checkRateLimit({
      key: `auth:password_forgot:ip:${clientIp}`,
      limit: RATE_LIMIT_CONFIG.authPasswordForgotPerIpLimit,
      windowMs: RATE_LIMIT_CONFIG.authPasswordForgotWindowMs,
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
      key: `auth:password_forgot:ip_email:${clientIp}:${email}`,
      limit: RATE_LIMIT_CONFIG.authPasswordForgotPerIpEmailLimit,
      windowMs: RATE_LIMIT_CONFIG.authPasswordForgotWindowMs,
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
  const smtp = await readSmtpConfig()
  if (!smtp.ok) {
    return ok({ ok: true, smtpAvailable: false, smtpCode: smtp.code })
  }

  const origin = requestOrigin(req)
  if (!origin) return ok({ ok: true, smtpAvailable: true })

  const user = await prisma.user
    .findUnique({ where: { email }, select: { id: true, isDisabled: true } })
    .catch(() => null)
  if (!user || user.isDisabled) return ok({ ok: true, smtpAvailable: true })

  const token = crypto.randomBytes(32).toString("base64url")
  const tokenHash = sha256Hex(token)
  const now = new Date()
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

  await prisma.passwordResetToken.create({
    data: {
      id: crypto.randomUUID(),
      userId: user.id,
      tokenHash,
      createdAt: now,
      expiresAt,
      usedAt: null,
      ip: clientIp === "unknown" ? null : clientIp,
      userAgent: req.headers.get("user-agent") ?? null,
    },
    select: { id: true },
  })

  const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
  })

  const msg = renderPasswordResetEmail({
    appName: "Maia",
    email,
    resetUrl,
    expiresIn: "1 hour",
    supportEmail: smtp.fromEmail || undefined,
    requestedAt: now.toISOString(),
    requestIp: clientIp === "unknown" ? null : clientIp,
    requestUserAgent: req.headers.get("user-agent") ?? null,
  })

  await transporter.sendMail({
    from: smtp.fromName ? `${smtp.fromName} <${smtp.fromEmail}>` : smtp.fromEmail,
    to: email,
    subject: msg.subject,
    text: msg.text,
  })

  return ok({ ok: true, smtpAvailable: true })
})
