import "server-only"

import { z } from "zod"

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from "@/lib/shared/i18n/constants"
import { USER_SETTING_KEYS, getUserSettingJson, setUserSettingJson } from "@/lib/server/settings/user-settings"

/**
 * Outbound language setting:
 * - "auto": use last-seen UI locale (persisted) with fallback to DEFAULT_LOCALE
 * - Locale: fixed locale for outbound content (emails, notifications, etc)
 */
export type OutboundLanguage = "auto" | Locale

const outboundLanguageSchema = z.union([
  z.literal("auto"),
  z
    .string()
    .trim()
    .refine((v) => (SUPPORTED_LOCALES as readonly string[]).includes(v), { message: "Unsupported locale" }),
])

const localeSchema = z
  .string()
  .trim()
  .refine((v) => (SUPPORTED_LOCALES as readonly string[]).includes(v), { message: "Unsupported locale" })

export async function getLastSeenUiLocaleForUser(userId: string): Promise<Locale | null> {
  const raw = await getUserSettingJson({ userId, key: USER_SETTING_KEYS.uiLocaleLastSeen })
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const v = localeSchema.safeParse(parsed)
    return v.success ? (v.data as Locale) : null
  } catch {
    return null
  }
}

export async function setLastSeenUiLocaleForUser(params: { userId: string; locale: Locale }) {
  const v = localeSchema.parse(params.locale) as Locale
  await setUserSettingJson({
    userId: params.userId,
    key: USER_SETTING_KEYS.uiLocaleLastSeen,
    valueJson: JSON.stringify(v),
    version: 1,
  })
}

/**
 * Reads the outbound language setting. If not set, defaults to "auto".
 */
export async function getOutboundLanguageForUser(userId: string): Promise<OutboundLanguage> {
  const raw = await getUserSettingJson({ userId, key: USER_SETTING_KEYS.outboundLanguage })
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      const v = outboundLanguageSchema.safeParse(parsed)
      return v.success ? (v.data as OutboundLanguage) : "auto"
    } catch {
      return "auto"
    }
  }

  return "auto"
}

export async function saveOutboundLanguageForUser(params: { userId: string; outboundLanguage: OutboundLanguage }) {
  const v = outboundLanguageSchema.parse(params.outboundLanguage) as OutboundLanguage
  await setUserSettingJson({
    userId: params.userId,
    key: USER_SETTING_KEYS.outboundLanguage,
    valueJson: JSON.stringify(v),
    version: 1,
  })

  return v
}

/**
 * Locale used for outbound content (emails, notifications, etc).
 * - fixed: the configured locale
 * - auto: last-seen UI locale (persisted) -> DEFAULT_LOCALE fallback
 */
export async function getOutboundLocaleForUser(userId: string): Promise<Locale> {
  const outboundLanguage = await getOutboundLanguageForUser(userId).catch(() => "auto" as const)
  if (outboundLanguage !== "auto") return outboundLanguage
  const lastSeen = await getLastSeenUiLocaleForUser(userId).catch(() => null)
  return (lastSeen ?? DEFAULT_LOCALE) as Locale
}
