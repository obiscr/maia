import "server-only"

import crypto from "node:crypto"

import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/db"
import { decryptUserSecret, encryptUserSecret } from "@/lib/server/settings/crypto"

export const SYSTEM_SECRET_SCOPE_ID = "system" as const

export const SYSTEM_SECRET_KEYS = {
  smtpPassword: "smtp.password",
} as const

export type SystemSecretKey = (typeof SYSTEM_SECRET_KEYS)[keyof typeof SYSTEM_SECRET_KEYS]

export async function upsertSystemSecret(params: { key: SystemSecretKey; plaintext: string }) {
  return await upsertSystemSecretTx(prisma, params)
}

export async function deleteSystemSecret(params: { key: SystemSecretKey }) {
  await deleteSystemSecretTx(prisma, params)
}

export async function hasSystemSecret(params: { key: SystemSecretKey }) {
  return await hasSystemSecretTx(prisma, params)
}

export async function getSystemSecretPlaintext(params: { key: SystemSecretKey; touchLastUsed?: boolean }) {
  const row = await prisma.systemSecret.findUnique({
    where: { key: params.key },
    select: {
      id: true,
      key: true,
      algorithm: true,
      keyVersion: true,
      ivBase64: true,
      ciphertextBase64: true,
      authTagBase64: true,
    },
  })
  if (!row) return null

  const plaintext = decryptUserSecret({
    userId: SYSTEM_SECRET_SCOPE_ID,
    key: row.key,
    algorithm: row.algorithm,
    keyVersion: row.keyVersion,
    ivBase64: row.ivBase64,
    ciphertextBase64: row.ciphertextBase64,
    authTagBase64: row.authTagBase64,
  })

  if (params.touchLastUsed) {
    void prisma.systemSecret.update({ where: { key: row.key }, data: { lastUsedAt: new Date() } }).catch(() => {})
  }

  return plaintext
}

export async function upsertSystemSecretTx(
  tx: Prisma.TransactionClient,
  params: { key: SystemSecretKey; plaintext: string },
) {
  const enc = encryptUserSecret({ userId: SYSTEM_SECRET_SCOPE_ID, key: params.key, plaintext: params.plaintext })
  const now = new Date()
  return await tx.systemSecret.upsert({
    where: { key: params.key },
    create: {
      id: crypto.randomUUID(),
      key: params.key,
      algorithm: enc.algorithm,
      keyVersion: enc.keyVersion,
      ivBase64: enc.ivBase64,
      ciphertextBase64: enc.ciphertextBase64,
      authTagBase64: enc.authTagBase64,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    },
    update: {
      algorithm: enc.algorithm,
      keyVersion: enc.keyVersion,
      ivBase64: enc.ivBase64,
      ciphertextBase64: enc.ciphertextBase64,
      authTagBase64: enc.authTagBase64,
      updatedAt: now,
    },
    select: { id: true },
  })
}

export async function deleteSystemSecretTx(tx: Prisma.TransactionClient, params: { key: SystemSecretKey }) {
  await tx.systemSecret.delete({ where: { key: params.key }, select: { id: true } }).catch(() => {})
}

export async function hasSystemSecretTx(tx: Prisma.TransactionClient, params: { key: SystemSecretKey }) {
  const row = await tx.systemSecret.findUnique({ where: { key: params.key }, select: { id: true } })
  return Boolean(row?.id)
}
