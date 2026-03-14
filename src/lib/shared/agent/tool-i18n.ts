export type ToolI18nTranslator = (i18nKey: string, vars?: Record<string, string | number>) => string

function tryTranslate(t: ToolI18nTranslator, i18nKey: string, vars?: Record<string, string | number>): string | null {
  const value = t(i18nKey, vars)
  return value === i18nKey ? null : value
}

export function splitToolName(toolName: string): { domain: string; action: string } | null {
  const raw = String(toolName ?? "")
  if (!raw) return null
  const dotIdx = raw.indexOf(".")
  const underscoreIdx = raw.indexOf("_")
  const separatorIdx = dotIdx > 0 ? dotIdx : underscoreIdx > 0 ? underscoreIdx : -1
  if (separatorIdx <= 0) return null
  return {
    domain: raw.slice(0, separatorIdx),
    action: raw.slice(separatorIdx + 1),
  }
}

export function resolveToolLabelI18n(t: ToolI18nTranslator, toolName: string): string {
  const direct = tryTranslate(t, `toolCalls.${toolName}.label`)
  if (direct) return direct

  const split = splitToolName(toolName)
  if (split) {
    const nested = tryTranslate(t, `toolCalls.${split.domain}.${split.action}.label`)
    if (nested) return nested
  }

  return toolName
}

export function resolveToolStatusI18n(
  t: ToolI18nTranslator,
  params: {
    toolName: string
    state: "todo" | "running" | "done" | "failed"
    fallbackStatus: string
    vars?: Record<string, string | number>
  },
): string {
  const { toolName, state, fallbackStatus, vars } = params

  const directStatus =
    (state === "done" && vars
      ? (tryTranslate(t, `toolCalls.${toolName}.doneWithCount`, vars) ??
        tryTranslate(t, `toolCalls.${toolName}.doneWithName`, vars))
      : null) ??
    (state === "running" && vars ? tryTranslate(t, `toolCalls.${toolName}.runningWithName`, vars) : null) ??
    tryTranslate(t, `toolCalls.${toolName}.${state}`) ??
    null
  if (directStatus) return directStatus

  const split = splitToolName(toolName)
  if (split) {
    const nested = tryTranslate(t, `toolCalls.${split.domain}.${split.action}.${state}`)
    if (nested) return nested
  }

  return tryTranslate(t, `toolCalls.status.${state}`) ?? fallbackStatus
}
