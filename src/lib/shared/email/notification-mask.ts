export const EMAIL_NOTIFICATION_BITS = {
  RUN_FAILED_NOTIFICATION: 1 << 0,
  RUN_SUCCEEDED_NOTIFICATION: 1 << 1,
  RUN_CANCELED_NOTIFICATION: 1 << 2,
} as const

export type EmailNotificationKey = keyof typeof EMAIL_NOTIFICATION_BITS

export function hasEmailNotification(mask: number, key: EmailNotificationKey): boolean {
  const m = Number.isFinite(mask) ? Math.max(0, Math.floor(mask)) : 0
  const bit = EMAIL_NOTIFICATION_BITS[key]
  return (m & bit) === bit
}

export function setEmailNotification(mask: number, key: EmailNotificationKey, enabled: boolean): number {
  const m = Number.isFinite(mask) ? Math.max(0, Math.floor(mask)) : 0
  const bit = EMAIL_NOTIFICATION_BITS[key]
  return enabled ? m | bit : m & ~bit
}
