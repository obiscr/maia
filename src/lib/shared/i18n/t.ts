import type { Messages } from "@/lib/shared/i18n/messages"

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

function getByPath(messages: Messages, key: string): string | undefined {
  const parts = key.split(".").filter(Boolean)
  let cur: unknown = messages
  for (const p of parts) {
    if (!isRecord(cur)) return undefined
    cur = cur[p]
  }
  return typeof cur === "string" ? cur : undefined
}

function interpolate(template: string, params?: Record<string, string | number>) {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k]
    return v === undefined || v === null ? `{${k}}` : String(v)
  })
}

export type TFunction = (key: string, params?: Record<string, string | number>) => string

export function hasKey(messages: Messages, key: string): boolean {
  return typeof getByPath(messages, key) === "string"
}

export function tOptional(messages: Messages, key: string, params?: Record<string, string | number>): string | null {
  const raw = getByPath(messages, key)
  if (!raw) return null
  return interpolate(raw, params)
}

export function createT(messages: Messages): TFunction {
  return (key, params) => {
    const raw = getByPath(messages, key)
    if (!raw) return key
    return interpolate(raw, params)
  }
}
