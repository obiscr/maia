import "server-only"

import crypto from "node:crypto"

import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { getSettingsEncryptionKeyBytes } from "@/lib/server/settings/crypto"
import { isCurrentDatabaseSchemaReadySync } from "@/lib/server/db/schema-ready"

export const INSTALLATION_ROW_ID = "installation" as const

export type RegistrationMode = "DISABLED" | "OPEN" | "INVITE_ONLY"

export async function getInstallation() {
  if (!isCurrentDatabaseSchemaReadySync()) return null
  return await prisma.installation.findUnique({
    where: { id: INSTALLATION_ROW_ID },
    select: {
      id: true,
      installedAt: true,
      instanceId: true,
      registrationMode: true,
      encryptionKeyFingerprint: true,
      smtpEnabled: true,
      smtpHost: true,
      smtpPort: true,
      smtpSecure: true,
      smtpUsername: true,
      smtpFromEmail: true,
      smtpFromName: true,
      createdAt: true,
      updatedAt: true,
    },
  })
}

export async function isInstalled() {
  const row = await getInstallation()
  return Boolean(row?.installedAt)
}

export async function getRegistrationMode(): Promise<RegistrationMode> {
  const row = await getInstallation()
  const mode = String(row?.registrationMode ?? "DISABLED").toUpperCase()
  if (mode === "OPEN" || mode === "INVITE_ONLY" || mode === "DISABLED") return mode
  return "DISABLED"
}

export function encryptionKeyFingerprint() {
  // Fingerprint is non-secret; used to detect key drift and produce nicer operator errors.
  const bytes = getSettingsEncryptionKeyBytes()
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16)
}

export async function ensureInstallationRow(params?: {
  installedAt?: Date | null
  registrationMode?: RegistrationMode
}) {
  return await ensureInstallationRowTx(prisma, params)
}

export async function ensureInstallationRowTx(
  tx: Prisma.TransactionClient,
  params?: {
    installedAt?: Date | null
    registrationMode?: RegistrationMode
  },
) {
  const now = new Date()
  const installedAt = params?.installedAt ?? null
  const fingerprint = encryptionKeyFingerprint()
  const instanceId = crypto.randomUUID()

  // Single-row upsert, safe for concurrent first-run requests.
  return await tx.installation.upsert({
    where: { id: INSTALLATION_ROW_ID },
    create: {
      id: INSTALLATION_ROW_ID,
      installedAt: installedAt,
      instanceId,
      registrationMode: params?.registrationMode ?? "DISABLED",
      encryptionKeyFingerprint: fingerprint,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      installedAt: installedAt ?? undefined,
      registrationMode: params?.registrationMode ?? undefined,
      encryptionKeyFingerprint: fingerprint ?? undefined,
      updatedAt: now,
    },
    select: { id: true },
  })
}
