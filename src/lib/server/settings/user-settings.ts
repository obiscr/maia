import "server-only"

import crypto from "node:crypto"

import { prisma } from "@/lib/server/db"

export type UserSettingKey = string

export const USER_SETTING_KEYS = {
  agentModel: "agent.model",
  agentMode: "agent.mode",
  uiTimezone: "ui.timezone",
  /**
   * Outbound language for emails/notifications.
   * - "auto": use last-seen UI locale (falls back to DEFAULT_LOCALE)
   * - "en" | "zh-cn": fixed locale
   */
  outboundLanguage: "outbound.language",
  /** Last-seen UI locale for this user (used by outboundLanguage="auto"). */
  uiLocaleLastSeen: "ui.localeLastSeen",
  emailNotificationMask: "email.notificationMask",
} as const

export async function getUserSettingJson(params: { userId: string; key: UserSettingKey }) {
  const row = await prisma.userSetting.findUnique({
    where: { userId_key: { userId: params.userId, key: params.key } },
    select: { valueJson: true },
  })
  return typeof row?.valueJson === "string" ? String(row.valueJson) : null
}

export async function setUserSettingJson(params: {
  userId: string
  key: UserSettingKey
  valueJson: string
  version?: number
}) {
  const now = new Date()
  await prisma.userSetting.upsert({
    where: { userId_key: { userId: params.userId, key: params.key } },
    create: {
      id: crypto.randomUUID(),
      userId: params.userId,
      key: params.key,
      valueJson: String(params.valueJson ?? "{}"),
      version: typeof params.version === "number" ? Math.floor(params.version) : 1,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      valueJson: String(params.valueJson ?? "{}"),
      version: typeof params.version === "number" ? Math.floor(params.version) : undefined,
      updatedAt: now,
    },
    select: { id: true },
  })
}

export async function deleteUserSetting(params: { userId: string; key: UserSettingKey }) {
  await prisma.userSetting
    .delete({
      where: { userId_key: { userId: params.userId, key: params.key } },
      select: { id: true },
    })
    .catch(() => {})
}
