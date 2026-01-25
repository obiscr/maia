import "server-only"

import crypto from "node:crypto"

import { prisma } from "@/lib/server/db"
import { decryptUserSecret, encryptUserSecret } from "@/lib/server/settings/crypto"

export const USER_SECRET_KEYS = {
  agentApiKey: "agent.apiKey",
} as const

export type UserSecretKey = (typeof USER_SECRET_KEYS)[keyof typeof USER_SECRET_KEYS]

export async function upsertUserSecret(params: { userId: string; key: UserSecretKey; plaintext: string }) {
  const enc = encryptUserSecret({ userId: params.userId, key: params.key, plaintext: params.plaintext })
  const now = new Date()
  return await prisma.userSecret.upsert({
    where: { userId_key: { userId: params.userId, key: params.key } },
    create: {
      id: crypto.randomUUID(),
      userId: params.userId,
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

export async function deleteUserSecret(params: { userId: string; key: UserSecretKey }) {
  await prisma.userSecret
    .delete({
      where: { userId_key: { userId: params.userId, key: params.key } },
      select: { id: true },
    })
    .catch(() => {})
}

export async function hasUserSecret(params: { userId: string; key: UserSecretKey }) {
  const row = await prisma.userSecret.findUnique({
    where: { userId_key: { userId: params.userId, key: params.key } },
    select: { id: true },
  })
  return Boolean(row?.id)
}

export async function getUserSecretPlaintext(params: { userId: string; key: UserSecretKey; touchLastUsed?: boolean }) {
  const row = await prisma.userSecret.findUnique({
    where: { userId_key: { userId: params.userId, key: params.key } },
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
    userId: params.userId,
    key: params.key,
    algorithm: row.algorithm,
    keyVersion: row.keyVersion,
    ivBase64: row.ivBase64,
    ciphertextBase64: row.ciphertextBase64,
    authTagBase64: row.authTagBase64,
  })

  if (params.touchLastUsed) {
    void prisma.userSecret.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  }

  return plaintext
}
