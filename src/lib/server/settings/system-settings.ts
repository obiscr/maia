import "server-only"

import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { normalizePublicBaseUrl } from "@/lib/shared/http/public-base-url"

export type SystemSettingKey = string

export const SYSTEM_SETTING_KEYS = {
  publicBaseUrl: "system.publicBaseUrl",
} as const

const publicBaseUrlSchema = z.string().trim().min(1)

export async function getSystemSettingJson(params: { key: SystemSettingKey }) {
  const row = await prisma.systemSetting.findUnique({
    where: { key: params.key },
    select: { valueJson: true },
  })
  return typeof row?.valueJson === "string" ? String(row.valueJson) : null
}

/**
 * Parse the stored SystemSetting `valueJson` for `system.publicBaseUrl`.
 *
 * Storage format: JSON string (e.g. `"https://example.com/app"`).
 * Returns a normalized base URL or null if missing/invalid.
 */
export function parsePublicBaseUrlSettingValueJson(valueJson: string | null | undefined): string | null {
  const raw = typeof valueJson === "string" ? valueJson : ""
  if (!raw.trim()) return null
  try {
    const parsed = JSON.parse(raw)
    const r = publicBaseUrlSchema.safeParse(parsed)
    if (!r.success) return null
    return normalizePublicBaseUrl(r.data)
  } catch {
    return null
  }
}

export async function setSystemSettingJson(params: { key: SystemSettingKey; valueJson: string; version?: number }) {
  const now = new Date()
  const version = Number.isFinite(params.version) ? Math.floor(params.version as number) : undefined
  await prisma.systemSetting.upsert({
    where: { key: params.key },
    create: {
      key: params.key,
      valueJson: String(params.valueJson ?? "{}"),
      version: version ?? 1,
      createdAt: now,
      updatedAt: now,
    },
    update: {
      valueJson: String(params.valueJson ?? "{}"),
      version,
      updatedAt: now,
    },
    select: { key: true },
  })
}

export async function deleteSystemSetting(params: { key: SystemSettingKey }) {
  await prisma.systemSetting
    .delete({
      where: { key: params.key },
      select: { key: true },
    })
    .catch(() => {})
}

export async function getSystemPublicBaseUrl(): Promise<string | null> {
  const raw = await getSystemSettingJson({ key: SYSTEM_SETTING_KEYS.publicBaseUrl })
  if (!raw) return null
  return parsePublicBaseUrlSettingValueJson(raw)
}

export async function setSystemPublicBaseUrl(next: string | null): Promise<{ publicBaseUrl: string | null }> {
  if (next === null) {
    await deleteSystemSetting({ key: SYSTEM_SETTING_KEYS.publicBaseUrl })
    return { publicBaseUrl: null }
  }
  const normalized = normalizePublicBaseUrl(next)
  if (!normalized) throw new Error("INVALID_PUBLIC_BASE_URL")
  await setSystemSettingJson({
    key: SYSTEM_SETTING_KEYS.publicBaseUrl,
    valueJson: JSON.stringify(normalized),
    version: 1,
  })
  return { publicBaseUrl: normalized }
}
