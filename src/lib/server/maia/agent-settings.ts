import "server-only"

import { z } from "zod"

import path from "node:path"
import fs from "node:fs/promises"

import {
  USER_SECRET_KEYS,
  hasUserSecret,
  getUserSecretPlaintext,
  upsertUserSecret,
  deleteUserSecret,
} from "@/lib/server/settings/user-secrets"
import { USER_SETTING_KEYS, getUserSettingJson, setUserSettingJson } from "@/lib/server/settings/user-settings"
import { pathExists, readJsonFile } from "@/lib/server/maia/fs"
import { maiaDataDir } from "@/lib/server/maia/paths"

export const agentSettingsSchema = z.object({
  apiKey: z.string().default(""),
  model: z.string().default("deepseek-chat"),
})

export type AgentSettings = z.infer<typeof agentSettingsSchema>

const agentModelSchema = z.enum(["deepseek-chat", "deepseek-reasoner"]).default("deepseek-chat")

function legacyAgentSettingsPath() {
  return path.join(maiaDataDir(), "settings", "agent.json")
}

function legacyAiSettingsPath() {
  return path.join(maiaDataDir(), "settings", "ai.json")
}

async function maybeImportLegacySettingsToUser(userId: string): Promise<void> {
  // Best-effort one-time import from legacy JSON into DB-backed per-user settings.
  // If multiple users exist, the first one to access settings will "claim" the legacy file.
  const agentPath = legacyAgentSettingsPath()
  const aiPath = legacyAiSettingsPath()
  const legacyPath = (await pathExists(agentPath)) ? agentPath : (await pathExists(aiPath)) ? aiPath : null
  if (!legacyPath) return

  // If the user already has a configured key, do not override.
  const hasKey = await hasUserSecret({ userId, key: USER_SECRET_KEYS.agentApiKey })
  if (hasKey) {
    // Still remove legacy file to prevent repeated imports.
    void fs.unlink(agentPath).catch(() => {})
    void fs.unlink(aiPath).catch(() => {})
    return
  }

  const raw = await readJsonFile<unknown>(legacyPath).catch(() => null)
  if (!raw) return

  const legacy = agentSettingsSchema.safeParse(raw)
  if (!legacy.success) return

  const apiKey = String(legacy.data.apiKey ?? "").trim()
  const model = String(legacy.data.model ?? "").trim()

  if (apiKey) {
    await upsertUserSecret({ userId, key: USER_SECRET_KEYS.agentApiKey, plaintext: apiKey })
  }
  if (model) {
    const safeModel = agentModelSchema.parse(model)
    await setUserSettingJson({
      userId,
      key: USER_SETTING_KEYS.agentModel,
      valueJson: JSON.stringify(safeModel),
      version: 1,
    })
  }

  // Remove legacy files once imported to avoid duplicating secrets across users.
  void fs.unlink(agentPath).catch(() => {})
  void fs.unlink(aiPath).catch(() => {})
}

async function readUserAgentModel(userId: string) {
  const raw = await getUserSettingJson({ userId, key: USER_SETTING_KEYS.agentModel })
  if (!raw) return agentModelSchema.parse(undefined)
  try {
    const parsed = JSON.parse(raw)
    return agentModelSchema.parse(parsed)
  } catch {
    return agentModelSchema.parse(undefined)
  }
}

/**
 * Internal server usage: returns plaintext apiKey (if configured) + model.
 * Do NOT expose apiKey to clients.
 */
export async function getAgentSettingsForUser(
  userId: string,
  opts?: { touchApiKeyLastUsed?: boolean },
): Promise<AgentSettings> {
  await maybeImportLegacySettingsToUser(userId).catch(() => {})
  const [model, apiKey] = await Promise.all([
    readUserAgentModel(userId),
    getUserSecretPlaintext({ userId, key: USER_SECRET_KEYS.agentApiKey, touchLastUsed: opts?.touchApiKeyLastUsed }),
  ])
  return agentSettingsSchema.parse({ apiKey: apiKey ?? "", model })
}

export async function getAgentSettingsStatusForUser(
  userId: string,
): Promise<{ apiKeyConfigured: boolean; model: string }> {
  await maybeImportLegacySettingsToUser(userId).catch(() => {})
  const [model, hasKey] = await Promise.all([
    readUserAgentModel(userId),
    hasUserSecret({ userId, key: USER_SECRET_KEYS.agentApiKey }),
  ])
  return { apiKeyConfigured: hasKey, model }
}

export async function saveAgentSettingsForUser(params: {
  userId: string
  apiKey?: string | null
  model?: string | null
}): Promise<{ apiKeyConfigured: boolean; model: string }> {
  await maybeImportLegacySettingsToUser(params.userId).catch(() => {})

  if (typeof params.model === "string") {
    const safeModel = agentModelSchema.parse(params.model)
    await setUserSettingJson({
      userId: params.userId,
      key: USER_SETTING_KEYS.agentModel,
      valueJson: JSON.stringify(safeModel),
      version: 1,
    })
  }

  if (params.apiKey === null) {
    await deleteUserSecret({ userId: params.userId, key: USER_SECRET_KEYS.agentApiKey })
  } else if (typeof params.apiKey === "string") {
    const trimmed = String(params.apiKey ?? "").trim()
    if (trimmed)
      await upsertUserSecret({ userId: params.userId, key: USER_SECRET_KEYS.agentApiKey, plaintext: trimmed })
  }

  return await getAgentSettingsStatusForUser(params.userId)
}
