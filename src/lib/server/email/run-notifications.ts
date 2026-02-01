import "server-only"

import { RunStatus } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { readSmtpConfig } from "@/lib/server/email/email-settings"
import { sendTemplatedEmail } from "@/lib/server/email/send-templated-email"
import { EMAIL_SETTINGS_ROW_ID } from "@/lib/server/installation"
import { DEFAULT_LOCALE } from "@/lib/shared/i18n/constants"
import { hasEmailNotification, type EmailNotificationKey } from "@/lib/shared/email/notification-mask"

type RunNotificationTemplateKey = "RUN_FAILED_NOTIFICATION" | "RUN_SUCCEEDED_NOTIFICATION" | "RUN_CANCELED_NOTIFICATION"

function templateKeyForStatus(status: RunStatus): RunNotificationTemplateKey | null {
  if (status === RunStatus.FAILED) return "RUN_FAILED_NOTIFICATION"
  if (status === RunStatus.SUCCEEDED) return "RUN_SUCCEEDED_NOTIFICATION"
  if (status === RunStatus.CANCELED) return "RUN_CANCELED_NOTIFICATION"
  return null
}

function preferredRecipientUserId(run: {
  ownerUserId: string | null
  createdByUserId: string | null
  triggeredByUserId: string | null
}): string | null {
  return run.ownerUserId ?? run.triggeredByUserId ?? run.createdByUserId ?? null
}

function normalizeOrigin(raw: unknown): string | null {
  const s = String(raw ?? "").trim()
  if (!s) return null
  if (s.startsWith("http://") || s.startsWith("https://")) return s.replace(/\/+$/, "")
  return null
}

function guessInstanceOrigin(): string | null {
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

export async function maybeSendRunTerminalNotification(params: { runId: string; status: RunStatus }) {
  const key = templateKeyForStatus(params.status)
  if (!key) return

  const settings = await prisma.emailSettings
    .findUnique({ where: { id: EMAIL_SETTINGS_ROW_ID }, select: { emailNotificationMask: true } })
    .catch(() => null)
  const mask = typeof settings?.emailNotificationMask === "number" ? settings.emailNotificationMask : 0

  const notifKey = key as EmailNotificationKey
  if (!hasEmailNotification(mask, notifKey)) return

  const smtp = await readSmtpConfig({ touchPasswordLastUsed: true })
  if (!smtp.ok) return

  const run = await prisma.run.findUnique({
    where: { id: params.runId },
    select: {
      publicId: true,
      workflowName: true,
      ownerUserId: true,
      createdByUserId: true,
      triggeredByUserId: true,
    },
  })
  if (!run) return

  const userId = preferredRecipientUserId({
    ownerUserId: run.ownerUserId ?? null,
    createdByUserId: run.createdByUserId ?? null,
    triggeredByUserId: run.triggeredByUserId ?? null,
  })
  if (!userId) return

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, isDisabled: true } })
  if (!user || user.isDisabled) return
  const toEmail = String(user.email ?? "").trim()
  if (!toEmail) return

  const origin = guessInstanceOrigin()
  const runUrl = origin ? `${origin}/runs/${encodeURIComponent(String(run.publicId))}` : ""

  const sent = await sendTemplatedEmail({
    smtp,
    to: toEmail,
    key,
    locale: DEFAULT_LOCALE,
    vars: {
      appName: "Maia",
      workflowName: String(run.workflowName ?? ""),
      runUrl,
    },
  })
  if (!sent.ok) return
}
