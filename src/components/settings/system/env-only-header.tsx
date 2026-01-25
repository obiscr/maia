"use client"

import * as React from "react"
import { AlertCircle, Copy } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import type { SystemEnvVarsMap } from "@/components/settings/system/hooks/use-system-env-vars"
import { Button } from "@/components/ui/button"
import { copyTextToClipboard } from "@/lib/client/clipboard"
import { toast } from "@/lib/client/toast"
import { cn } from "@/lib/utils"

export function EnvOnlyHeader(props: {
  className?: string
  exportNames: readonly string[]
  sensitiveNames?: readonly string[]
  vars: SystemEnvVarsMap
}) {
  const { t } = useI18n()

  const sensitive = React.useMemo(() => new Set<string>(props.sensitiveNames ?? []), [props.sensitiveNames])

  async function copyEnvSnippet() {
    const lines = props.exportNames.map((name) => {
      if (sensitive.has(name)) return `${name}=`
      const v = props.vars[name]
      const value = typeof v?.effectiveValue === "string" ? v.effectiveValue : ""
      return `${name}=${value}`
    })
    try {
      await copyTextToClipboard(lines.join("\n") + "\n")
      toast(t("common.copied"))
    } catch {
      toast.error(t("common.copyActionFailed"))
    }
  }

  return (
    <div className={cn("flex items-center justify-between gap-3", props.className)}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
        <span>{t("settings.system.envOnly.requiresRestart")}</span>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={() => void copyEnvSnippet()}>
        <Copy className="size-4" aria-hidden="true" />
        {t("settings.system.envOnly.copyEnvSnippetAction")}
      </Button>
    </div>
  )
}
