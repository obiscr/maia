import "server-only"

import { RunStatus } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { readSmtpConfig } from "@/lib/server/email/email-settings"
import { sendTemplatedEmail } from "@/lib/server/email/send-templated-email"
import { getEmailNotificationMaskOverrideForUser } from "@/lib/server/email/user-email-notification-settings"
import { EMAIL_SETTINGS_ROW_ID } from "@/lib/server/installation"
import { hasEmailNotification, type EmailNotificationKey } from "@/lib/shared/email/notification-mask"
import { getSystemPublicBaseUrl } from "@/lib/server/settings/system-settings"
import { joinPublicBaseUrl } from "@/lib/shared/http/public-base-url"
import { getOutboundLocaleForUser } from "@/lib/server/settings/outbound-language-settings"

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

export async function maybeSendRunTerminalNotification(params: { runId: string; status: RunStatus }) {
  const key = templateKeyForStatus(params.status)
  if (!key) return

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

  const [userMaskOverride, systemSettings] = await Promise.all([
    getEmailNotificationMaskOverrideForUser(userId).catch(() => null),
    prisma.emailSettings
      .findUnique({ where: { id: EMAIL_SETTINGS_ROW_ID }, select: { emailNotificationMask: true } })
      .catch(() => null),
  ])

  const systemMask =
    typeof systemSettings?.emailNotificationMask === "number" ? systemSettings.emailNotificationMask : 0
  const mask = typeof userMaskOverride === "number" ? userMaskOverride : systemMask

  const notifKey = key as EmailNotificationKey
  if (!hasEmailNotification(mask, notifKey)) return

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, isDisabled: true } })
  if (!user || user.isDisabled) return
  const toEmail = String(user.email ?? "").trim()
  if (!toEmail) return

  const smtp = await readSmtpConfig({ touchPasswordLastUsed: true })
  if (!smtp.ok) return

  const baseUrl = await getSystemPublicBaseUrl().catch(() => null)
  if (!baseUrl) {
    console.warn(
      `[email] skipped run notification (missing Public Base URL): key=${key} runId=${String(params.runId)} runPublicId=${String(run.publicId ?? "")}`,
    )
    return
  }
  const runPath = `/runs/${encodeURIComponent(String(run.publicId))}`
  const runUrl = joinPublicBaseUrl(baseUrl, runPath)

  const locale = await getOutboundLocaleForUser(userId)
  const sent = await sendTemplatedEmail({
    smtp,
    to: toEmail,
    key,
    locale,
    vars: {
      appName: "Maia",
      workflowName: String(run.workflowName ?? ""),
      runUrl,
      runPublicId: String(run.publicId ?? ""),
    },
  })
  if (!sent.ok) return
}
