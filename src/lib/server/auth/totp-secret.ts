import "server-only"

import { prisma } from "@/lib/server/db"
import {
  USER_SECRET_KEYS,
  deleteUserSecret,
  getUserSecretPlaintext,
  upsertUserSecret,
} from "@/lib/server/settings/user-secrets"

export async function getTotpSecretBase32ForUser(userId: string) {
  const fromSecret = await getUserSecretPlaintext({
    userId,
    key: USER_SECRET_KEYS.authTotpSecret,
    touchLastUsed: true,
  }).catch(() => null)
  if (fromSecret) return String(fromSecret).trim() || null

  // Backward-compatible fallback: older installs stored plaintext on User.totpSecret.
  const legacy = await prisma.user.findUnique({ where: { id: userId }, select: { totpSecret: true } }).catch(() => null)
  const legacySecret = legacy?.totpSecret ? String(legacy.totpSecret).trim() : null
  if (!legacySecret) return null

  // Best-effort migration: encrypt-at-rest via UserSecret, then clear plaintext column.
  await upsertUserSecret({ userId, key: USER_SECRET_KEYS.authTotpSecret, plaintext: legacySecret }).catch(() => {})
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: null }, select: { id: true } }).catch(() => {})

  return legacySecret
}

export async function clearTotpSecretForUser(userId: string) {
  await deleteUserSecret({ userId, key: USER_SECRET_KEYS.authTotpSecret }).catch(() => {})
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: null }, select: { id: true } }).catch(() => {})
}
