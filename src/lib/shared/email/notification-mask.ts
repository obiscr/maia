export const EMAIL_NOTIFICATION_BITS = {
  RUN_FAILED_NOTIFICATION: 1 << 0,
  RUN_SUCCEEDED_NOTIFICATION: 1 << 1,
  RUN_CANCELED_NOTIFICATION: 1 << 2,
} as const

export type EmailNotificationKey = keyof typeof EMAIL_NOTIFICATION_BITS

export const EMAIL_NOTIFICATION_ALL_BITS = Object.values(EMAIL_NOTIFICATION_BITS).reduce((acc, v) => acc + v, 0)

function isBitSet(mask: number, bit: number): boolean {
  // For powers-of-two bits, the nth bit is set iff floor(mask / bit) is odd.
  return Math.floor(mask / bit) % 2 === 1
}

export function isValidEmailNotificationMask(mask: unknown): mask is number {
  if (typeof mask !== "number" || !Number.isFinite(mask)) return false
  const m = Math.floor(mask)
  if (!Number.isSafeInteger(m)) return false
  if (m < 0) return false

  // Only allow known bits (avoid bitwise ops to prevent JS 32-bit truncation).
  let remaining = m
  for (const bit of Object.values(EMAIL_NOTIFICATION_BITS)) {
    if (isBitSet(m, bit)) remaining -= bit
  }
  return remaining === 0
}

export function normalizeEmailNotificationMask(mask: unknown): number {
  return isValidEmailNotificationMask(mask) ? Math.floor(mask) : 0
}

export function hasEmailNotification(mask: number, key: EmailNotificationKey): boolean {
  const m = normalizeEmailNotificationMask(mask)
  const bit = EMAIL_NOTIFICATION_BITS[key]
  return (m & bit) === bit
}

export function setEmailNotification(mask: number, key: EmailNotificationKey, enabled: boolean): number {
  const m = normalizeEmailNotificationMask(mask)
  const bit = EMAIL_NOTIFICATION_BITS[key]
  return enabled ? m | bit : m & ~bit
}
