import "server-only"

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import { maiaDataDir } from "@/lib/server/maia/paths"

export const USER_SECRET_ALGORITHM = "aes-256-gcm" as const
export const USER_SECRET_KEY_VERSION = 1 as const

export function parseKeyMaterial(raw: string): Buffer {
  const s = String(raw ?? "").trim()
  if (!s) throw new Error("SETTINGS_ENCRYPTION_KEY_MISSING")

  // Preferred: base64 (32 bytes).
  try {
    const b = Buffer.from(s, "base64")
    if (b.length === 32) return b
  } catch {
    // fallthrough
  }

  // Fallback: hex (64 chars).
  try {
    const b = Buffer.from(s, "hex")
    if (b.length === 32) return b
  } catch {
    // fallthrough
  }

  throw new Error("SETTINGS_ENCRYPTION_KEY_INVALID")
}

function persistedKeyPath() {
  return path.join(maiaDataDir(), "settings", "encryption.key")
}

/**
 * Returns the 32-byte encryption key material used for per-user secrets.
 *
 * Key source priority:
 * - SETTINGS_ENCRYPTION_KEY env var (operator-managed)
 * - persisted key file in data dir (auto-generated on first use)
 *
 * This keeps dev + Docker UX simple while still allowing operators to override via env.
 */
export function getSettingsEncryptionKeyBytes(): Buffer {
  const rawEnv = String(process.env.SETTINGS_ENCRYPTION_KEY ?? "").trim()
  if (rawEnv) return parseKeyMaterial(rawEnv)

  const p = persistedKeyPath()
  try {
    const raw = fs.readFileSync(p, "utf8")
    return parseKeyMaterial(String(raw ?? "").trim())
  } catch (e) {
    const code = typeof (e as { code?: unknown })?.code === "string" ? String((e as { code?: unknown }).code) : null
    if (code && code !== "ENOENT") throw e
  }

  // First-run: generate and persist (0600).
  const dir = path.dirname(p)
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
  const generated = crypto.randomBytes(32).toString("base64")
  try {
    fs.writeFileSync(p, generated, { encoding: "utf8", mode: 0o600, flag: "wx" })
  } catch (e) {
    // Another concurrent request likely wrote it; read again.
    const raw = fs.readFileSync(p, "utf8")
    return parseKeyMaterial(String(raw ?? "").trim())
  }
  return parseKeyMaterial(generated)
}

function aadFor(params: { userId: string; key: string }) {
  return Buffer.from(`user:${params.userId}|key:${params.key}`, "utf8")
}

export type EncryptedPayload = {
  algorithm: typeof USER_SECRET_ALGORITHM
  keyVersion: typeof USER_SECRET_KEY_VERSION
  ivBase64: string
  ciphertextBase64: string
  authTagBase64: string
}

export function encryptUserSecret(params: { userId: string; key: string; plaintext: string }): EncryptedPayload {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(USER_SECRET_ALGORITHM, getSettingsEncryptionKeyBytes(), iv)
  cipher.setAAD(aadFor({ userId: params.userId, key: params.key }))
  const ciphertext = Buffer.concat([cipher.update(String(params.plaintext ?? ""), "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    algorithm: USER_SECRET_ALGORITHM,
    keyVersion: USER_SECRET_KEY_VERSION,
    ivBase64: iv.toString("base64"),
    ciphertextBase64: ciphertext.toString("base64"),
    authTagBase64: tag.toString("base64"),
  }
}

export function decryptUserSecret(params: {
  userId: string
  key: string
  algorithm: string
  keyVersion: number
  ivBase64: string
  ciphertextBase64: string
  authTagBase64: string
}) {
  if (params.algorithm !== USER_SECRET_ALGORITHM) throw new Error("USER_SECRET_ALG_UNSUPPORTED")
  if (Number(params.keyVersion) !== USER_SECRET_KEY_VERSION) throw new Error("USER_SECRET_KEY_VERSION_UNSUPPORTED")

  const iv = Buffer.from(String(params.ivBase64 ?? ""), "base64")
  const ciphertext = Buffer.from(String(params.ciphertextBase64 ?? ""), "base64")
  const tag = Buffer.from(String(params.authTagBase64 ?? ""), "base64")

  const decipher = crypto.createDecipheriv(USER_SECRET_ALGORITHM, getSettingsEncryptionKeyBytes(), iv)
  decipher.setAAD(aadFor({ userId: params.userId, key: params.key }))
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
  return plaintext
}
