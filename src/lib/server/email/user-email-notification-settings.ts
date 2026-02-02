import "server-only"

import { z } from "zod"

import {
  USER_SETTING_KEYS,
  getUserSettingJson,
  setUserSettingJson,
  deleteUserSetting,
} from "@/lib/server/settings/user-settings"
import { isValidEmailNotificationMask, normalizeEmailNotificationMask } from "@/lib/shared/email/notification-mask"

const maskSchema = z
  .number()
  .int()
  .refine((v) => isValidEmailNotificationMask(v), "mask contains unknown bits")

/**
 * Returns the user's override mask if configured; otherwise null (caller should fall back to system default).
 */
export async function getEmailNotificationMaskOverrideForUser(userId: string): Promise<number | null> {
  const raw = await getUserSettingJson({ userId, key: USER_SETTING_KEYS.emailNotificationMask })
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const r = maskSchema.safeParse(parsed)
    return r.success ? normalizeEmailNotificationMask(r.data) : null
  } catch {
    return null
  }
}

/**
 * Set or clear the user's override.
 * - null => clear override (fall back to system default)
 */
export async function saveEmailNotificationMaskOverrideForUser(params: {
  userId: string
  mask: number | null
}): Promise<{ mask: number | null }> {
  if (params.mask === null) {
    await deleteUserSetting({ userId: params.userId, key: USER_SETTING_KEYS.emailNotificationMask })
    return { mask: null }
  }

  const mask = normalizeEmailNotificationMask(maskSchema.parse(params.mask))
  await setUserSettingJson({
    userId: params.userId,
    key: USER_SETTING_KEYS.emailNotificationMask,
    valueJson: JSON.stringify(mask),
    version: 1,
  })
  return { mask }
}
