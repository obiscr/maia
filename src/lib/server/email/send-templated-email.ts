import "server-only"

import nodemailer from "nodemailer"
import type { EmailTemplateKey } from "@prisma/client"

import type { SmtpConfigOk } from "@/lib/server/email/email-settings"
import { renderEmailTemplate } from "@/lib/server/email/email-template-render"

export type RequestLocale = "en" | "zh-cn"
export type EmailSendResult =
  | { emailSent: true; emailErrorCode: null; messageId: string }
  | { emailSent: false; emailErrorCode: string }

function normalizeOrigin(raw: unknown): string | null {
  const s = String(raw ?? "").trim()
  if (!s) return null
  if (s.startsWith("http://") || s.startsWith("https://")) return s.replace(/\/+$/, "")
  return null
}

function configuredPublicOrigin(): string | null {
  const candidates = [
    process.env.MAIA_PUBLIC_ORIGIN,
    process.env.PUBLIC_ORIGIN,
    process.env.APP_ORIGIN,
    process.env.NEXT_PUBLIC_APP_ORIGIN,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.SITE_URL,
  ]
  for (const c of candidates) {
    const o = normalizeOrigin(c)
    if (o) return o
  }
  return null
}

export function requestOrigin(req: Request): string | null {
  // Prefer explicit operator configuration over request headers (reverse proxy / multi-domain safe).
  const configured = configuredPublicOrigin()
  if (configured) return configured

  const proto = req.headers.get("x-forwarded-proto") ?? "http"
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
  if (!host) return null
  const protoFirst = String(proto).split(",")[0]?.trim() || "http"
  const hostFirst = String(host).split(",")[0]?.trim()
  if (!hostFirst) return null
  return `${protoFirst}://${hostFirst}`
}

export function requestLocale(req: Request): RequestLocale {
  const raw = String(req.headers.get("accept-language") ?? "").toLowerCase()
  if (raw.includes("zh")) return "zh-cn"
  return "en"
}

function formatFrom(smtp: SmtpConfigOk) {
  return smtp.fromName ? `${smtp.fromName} <${smtp.fromEmail}>` : smtp.fromEmail
}

function createSmtpTransport(smtp: SmtpConfigOk) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
  })
}

export async function sendTemplatedEmail(params: {
  smtp: SmtpConfigOk
  to: string
  key: EmailTemplateKey
  locale?: string | null
  vars: Record<string, unknown>
}): Promise<{ ok: true; messageId: string } | { ok: false; code: "TEMPLATE_MISSING" }> {
  const msg = await renderEmailTemplate({
    key: params.key,
    locale: params.locale,
    vars: params.vars,
  })
  if (!msg) return { ok: false, code: "TEMPLATE_MISSING" }

  const transporter = createSmtpTransport(params.smtp)
  const info = await transporter.sendMail({
    from: formatFrom(params.smtp),
    to: params.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text ?? undefined,
  })

  const messageId = typeof info.messageId === "string" ? info.messageId : String(info.messageId ?? "")
  return { ok: true, messageId }
}

export async function sendTemplatedEmailBestEffort(params: {
  smtp: SmtpConfigOk
  to: string
  key: EmailTemplateKey
  locale?: string | null
  vars: Record<string, unknown>
}): Promise<EmailSendResult> {
  try {
    const sent = await sendTemplatedEmail(params)
    if (sent.ok) return { emailSent: true, emailErrorCode: null, messageId: sent.messageId }
    return { emailSent: false, emailErrorCode: sent.code }
  } catch {
    return { emailSent: false, emailErrorCode: "SEND_FAILED" }
  }
}
