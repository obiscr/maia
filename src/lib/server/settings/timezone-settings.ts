import "server-only"

import { z } from "zod"

import { USER_SETTING_KEYS, getUserSettingJson, setUserSettingJson } from "@/lib/server/settings/user-settings"

// Keep validation intentionally permissive:
// - Accept IANA names like "Asia/Shanghai"
// - Accept "UTC"
// - Do not hard-depend on Intl.supportedValuesOf (varies across runtimes)
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((s) => s === "UTC" || s.includes("/"), { message: "Invalid timezone" })

export async function getUiTimezoneForUser(userId: string): Promise<string | null> {
  const raw = await getUserSettingJson({ userId, key: USER_SETTING_KEYS.uiTimezone })
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const tz = timezoneSchema.safeParse(parsed)
    return tz.success ? tz.data : null
  } catch {
    return null
  }
}

export async function saveUiTimezoneForUser(params: {
  userId: string
  // null => clear (fall back to browser timezone)
  timezone: string | null
}): Promise<{ timezone: string | null }> {
  if (params.timezone === null) {
    // Store explicit null? Keep it simple: write "null" so reads are stable.
    await setUserSettingJson({
      userId: params.userId,
      key: USER_SETTING_KEYS.uiTimezone,
      valueJson: "null",
      version: 1,
    })
    return { timezone: null }
  }

  const tz = timezoneSchema.parse(params.timezone)
  await setUserSettingJson({
    userId: params.userId,
    key: USER_SETTING_KEYS.uiTimezone,
    valueJson: JSON.stringify(tz),
    version: 1,
  })
  return { timezone: tz }
}
