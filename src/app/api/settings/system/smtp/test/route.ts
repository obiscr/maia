import { z } from "zod"

import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { prisma } from "@/lib/server/db"
import { readSmtpConfig } from "@/lib/server/email/email-settings"
import { preferredPublicBaseUrl, sendTemplatedEmail } from "@/lib/server/email/send-templated-email"
import { EMAIL_SETTINGS_ROW_ID, INSTALLATION_ROW_ID, ensureInstallationRowTx } from "@/lib/server/installation"
import {
  SYSTEM_SECRET_KEYS,
  deleteSystemSecretTx,
  hasSystemSecret,
  upsertSystemSecretTx,
} from "@/lib/server/settings/system-secrets"
import { getOutboundLocaleForUser } from "@/lib/server/settings/outbound-language-settings"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const schema = z.object({
  toEmail: z.string().trim().email(),

  // Optional: allow testing with current form values (avoids "save required" deadlock).
  smtpHost: z.union([z.string(), z.null()]).optional(),
  smtpPort: z.union([z.number().int().min(1).max(65535), z.null()]).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUsername: z.union([z.string(), z.null()]).optional(),
  smtpFromEmail: z.union([z.string().email(), z.null()]).optional(),
  smtpFromName: z.union([z.string(), z.null()]).optional(),
  // If provided and non-empty, update the stored secret.
  smtpPassword: z.union([z.string(), z.null()]).optional(),
})

export const POST = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })
  if (String(user.role) !== "ADMIN") return fail({ status: 403, code: "FORBIDDEN" })

  let body: z.infer<typeof schema>
  try {
    body = schema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const touchedSmtp =
    body.smtpHost !== undefined ||
    body.smtpPort !== undefined ||
    body.smtpSecure !== undefined ||
    body.smtpUsername !== undefined ||
    body.smtpFromEmail !== undefined ||
    body.smtpFromName !== undefined ||
    body.smtpPassword !== undefined

  // If the client sent SMTP fields, persist them first (kept disabled) so verification can be recorded.
  if (touchedSmtp) {
    await prisma
      .$transaction(async (tx) => {
        await ensureInstallationRowTx(tx, {})

        const emailUpdate: Record<string, unknown> = { smtpVerifiedAt: null }
        const instUpdate: Record<string, unknown> = {}

        if (body.smtpHost === null) {
          emailUpdate.smtpHost = null
          instUpdate.smtpHost = null
        } else if (typeof body.smtpHost === "string") {
          const v = body.smtpHost.trim() || null
          emailUpdate.smtpHost = v
          instUpdate.smtpHost = v
        }

        if (body.smtpPort === null) {
          emailUpdate.smtpPort = null
          instUpdate.smtpPort = null
        } else if (typeof body.smtpPort === "number") {
          emailUpdate.smtpPort = body.smtpPort
          instUpdate.smtpPort = body.smtpPort
        }

        if (typeof body.smtpSecure === "boolean") {
          emailUpdate.smtpSecure = body.smtpSecure
          instUpdate.smtpSecure = body.smtpSecure
        }

        if (body.smtpUsername === null) {
          emailUpdate.smtpUsername = null
          instUpdate.smtpUsername = null
        } else if (typeof body.smtpUsername === "string") {
          const v = body.smtpUsername.trim() || null
          emailUpdate.smtpUsername = v
          instUpdate.smtpUsername = v
        }

        if (body.smtpFromEmail === null) {
          emailUpdate.smtpFromEmail = null
          instUpdate.smtpFromEmail = null
        } else if (typeof body.smtpFromEmail === "string") {
          const v = body.smtpFromEmail.trim() || null
          emailUpdate.smtpFromEmail = v
          instUpdate.smtpFromEmail = v
        }

        if (body.smtpFromName === null) {
          emailUpdate.smtpFromName = null
          instUpdate.smtpFromName = null
        } else if (typeof body.smtpFromName === "string") {
          const v = body.smtpFromName.trim() || null
          emailUpdate.smtpFromName = v
          instUpdate.smtpFromName = v
        }

        if (typeof body.smtpPassword === "string") {
          const trimmed = body.smtpPassword.trim()
          if (trimmed) await upsertSystemSecretTx(tx, { key: SYSTEM_SECRET_KEYS.smtpPassword, plaintext: trimmed })
        } else if (body.smtpPassword === null) {
          await deleteSystemSecretTx(tx, { key: SYSTEM_SECRET_KEYS.smtpPassword })
        }

        if (Object.keys(instUpdate).length) {
          await tx.installation.update({ where: { id: INSTALLATION_ROW_ID }, data: instUpdate })
        }

        await tx.emailSettings.upsert({
          where: { id: EMAIL_SETTINGS_ROW_ID },
          create: {
            id: EMAIL_SETTINGS_ROW_ID,
            installationId: INSTALLATION_ROW_ID,
            smtpEnabled: false,
            emailNotificationMask: 0,
            ...emailUpdate,
          },
          update: emailUpdate,
        })
      })
      .catch(() => {})
  }

  const smtp = await readSmtpConfig({ touchPasswordLastUsed: true, ignoreEnabled: true })
  if (!smtp.ok) {
    const codeToStatus: Record<string, number> = {
      SYSTEM_SMTP_NOT_INSTALLED: 409,
      SYSTEM_SMTP_DISABLED: 409,
      SYSTEM_SMTP_INCOMPLETE: 422,
      SYSTEM_SMTP_PASSWORD_MISSING: 422,
    }
    return fail({ status: codeToStatus[smtp.code] ?? 422, code: smtp.code })
  }

  const locale = await getOutboundLocaleForUser(user.id)
  const origin = await preferredPublicBaseUrl(req)
  if (!origin) {
    console.warn(`[email] skipped smtp test email (missing Public Base URL): userId=${user.id}`)
    return fail({ status: 409, code: "SYSTEM_PUBLIC_BASE_URL_REQUIRED" })
  }
  const sent = await sendTemplatedEmail({
    smtp,
    to: body.toEmail,
    key: "SYSTEM_SMTP_TEST",
    locale,
    vars: { appName: "Maia", instanceOrigin: origin },
  })
  if (!sent.ok) return fail({ status: 500, code: sent.code })

  // Mark SMTP as verified on successful send.
  await prisma.emailSettings
    .upsert({
      where: { id: EMAIL_SETTINGS_ROW_ID },
      create: {
        id: EMAIL_SETTINGS_ROW_ID,
        installationId: INSTALLATION_ROW_ID,
        smtpVerifiedAt: new Date(),
      },
      update: { smtpVerifiedAt: new Date() },
      select: { id: true },
    })
    .catch(() => {})

  const [emailSettings, passConfigured] = await Promise.all([
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
          smtpVerifiedAt: true,
        },
      })
      .catch(() => null),
    hasSystemSecret({ key: SYSTEM_SECRET_KEYS.smtpPassword }).catch(() => false),
  ])

  return ok({
    ok: true,
    messageId: sent.messageId,
    settings: {
      smtpEnabled: Boolean(emailSettings?.smtpEnabled ?? false),
      smtpHost: emailSettings?.smtpHost ?? "",
      smtpPort: typeof emailSettings?.smtpPort === "number" ? emailSettings.smtpPort : null,
      smtpSecure: Boolean(emailSettings?.smtpSecure ?? false),
      smtpUsername: emailSettings?.smtpUsername ?? "",
      smtpFromEmail: emailSettings?.smtpFromEmail ?? "",
      smtpFromName: emailSettings?.smtpFromName ?? "",
      smtpPasswordConfigured: passConfigured,
      smtpVerifiedAt: emailSettings?.smtpVerifiedAt ? emailSettings.smtpVerifiedAt.toISOString() : null,
    },
  })
})
