import "server-only"

import { prisma } from "@/lib/server/db"
import { EMAIL_SETTINGS_ROW_ID } from "@/lib/server/installation"
import { SYSTEM_SECRET_KEYS, getSystemSecretPlaintext } from "@/lib/server/settings/system-secrets"

export type SmtpConfigOk = {
  ok: true
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  fromEmail: string
  fromName: string
}

export type SmtpConfigErrCode =
  | "SYSTEM_SMTP_NOT_INSTALLED"
  | "SYSTEM_SMTP_DISABLED"
  | "SYSTEM_SMTP_INCOMPLETE"
  | "SYSTEM_SMTP_PASSWORD_MISSING"

export type SmtpConfigResult = SmtpConfigOk | { ok: false; code: SmtpConfigErrCode }

export async function readSmtpConfig(params?: {
  touchPasswordLastUsed?: boolean
  ignoreEnabled?: boolean
}): Promise<SmtpConfigResult> {
  const [emailSettings, legacyInst] = await Promise.all([
    prisma.emailSettings
      .findUnique({
        where: { id: EMAIL_SETTINGS_ROW_ID },
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
      .catch(() => null),
    prisma.installation
      .findUnique({
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
      .catch(() => null),
  ])

  const source = emailSettings ?? legacyInst
  if (!source) return { ok: false, code: "SYSTEM_SMTP_NOT_INSTALLED" }
  if (!params?.ignoreEnabled && !source.smtpEnabled) return { ok: false, code: "SYSTEM_SMTP_DISABLED" }

  const host = String(source.smtpHost ?? "").trim()
  const port = typeof source.smtpPort === "number" ? source.smtpPort : null
  const secure = Boolean(source.smtpSecure)
  const username = String(source.smtpUsername ?? "").trim()
  const fromEmail = String(source.smtpFromEmail ?? "").trim() || username
  const fromName = String(source.smtpFromName ?? "").trim() || "Maia"

  if (!host || !port) return { ok: false, code: "SYSTEM_SMTP_INCOMPLETE" }
  if (!fromEmail) return { ok: false, code: "SYSTEM_SMTP_INCOMPLETE" }

  const password = await getSystemSecretPlaintext({
    key: SYSTEM_SECRET_KEYS.smtpPassword,
    touchLastUsed: Boolean(params?.touchPasswordLastUsed),
  }).catch(() => null)
  if (!password) return { ok: false, code: "SYSTEM_SMTP_PASSWORD_MISSING" }

  return { ok: true, host, port, secure, username, password, fromEmail, fromName }
}
