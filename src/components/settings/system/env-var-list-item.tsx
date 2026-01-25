"use client"

import * as React from "react"
import { Copy } from "lucide-react"

import { CommonListItem } from "@/components/common/common-list-item"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { copyTextToClipboard } from "@/lib/client/clipboard"
import { toast } from "@/lib/client/toast"

export type EnvVarSource = "env" | "default" | "invalid_env"

export type EnvVarListItemModel = {
  name: string
  description: string
  defaultValue?: string
  effectiveValue?: string
  // For sensitive values that shouldn't be revealed, pass isSet instead of effectiveValue.
  isSet?: boolean
  source?: EnvVarSource
}

export function EnvVarListItem(props: EnvVarListItemModel) {
  const { t } = useI18n()
  const example = `${props.name}=${props.defaultValue ?? ""}`

  const sourceLabelKeyBySource: Record<EnvVarSource, string> = {
    env: "settings.system.common.sources.env",
    default: "settings.system.common.sources.default",
    invalid_env: "settings.system.common.sources.invalid_env",
  }
  const sourceLabelKey = props.source ? sourceLabelKeyBySource[props.source] : null

  async function doCopy(value: string) {
    try {
      await copyTextToClipboard(value)
      toast(t("common.copied"))
    } catch {
      toast.error(t("common.copyActionFailed"))
    }
  }

  const effectiveLabel = (() => {
    if (typeof props.effectiveValue === "string") return props.effectiveValue
    if (typeof props.isSet === "boolean")
      return props.isSet ? t("settings.system.envOnly.set") : t("settings.system.envOnly.unset")
    return null
  })()

  const leftColumn = (
    <ItemContent className="min-w-0">
      <ItemTitle className="w-full min-w-0 text-base leading-snug">
        <span className="text-sm block truncate font-mono">{props.name}</span>
      </ItemTitle>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {props.defaultValue != null ? (
          <span>
            {t("settings.system.common.defaultLabel")} <span className="font-mono">{props.defaultValue}</span>
          </span>
        ) : null}
        {effectiveLabel != null ? (
          <span>
            {t("settings.system.common.effectiveLabel")} <span className="font-mono">{effectiveLabel}</span>
          </span>
        ) : null}
        {props.source ? (
          <span>
            {t("settings.system.common.sourceLabel")} {sourceLabelKey ? t(sourceLabelKey) : ""}
          </span>
        ) : null}
      </div>

      <ItemDescription className="mt-1 line-clamp-2 text-xs">{props.description}</ItemDescription>
      {props.source === "invalid_env" ? (
        <div className="mt-1 text-xs text-muted-foreground">{t("settings.system.envOnly.invalidEnvHint")}</div>
      ) : null}
    </ItemContent>
  )

  const actions = (
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => void doCopy(props.name)}>
        <Copy className="size-4" aria-hidden="true" />
        {t("settings.system.envOnly.copyNameAction")}
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={() => void doCopy(example)}>
        <Copy className="size-4" aria-hidden="true" />
        {t("settings.system.envOnly.copyExampleAction")}
      </Button>
    </div>
  )

  return <CommonListItem columns={[{ key: "left", content: leftColumn, showOnMobile: true }]} actions={actions} />
}
