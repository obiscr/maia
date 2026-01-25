"use client"

import * as React from "react"
import Editor, { type EditorProps } from "@monaco-editor/react"

import { useI18nOptional } from "@/components/i18n-provider"
import { Spinner } from "@/components/ui/spinner"
import { setWorkflowCompletionMessages } from "@/lib/client/monaco-workflow-completions"
import { cn } from "@/lib/utils"

function DefaultMonacoLoading(props: { className?: string; label?: string }) {
  const i18n = useI18nOptional()
  const label = props.label ?? (i18n ? i18n.t("common.loading") : "Loading…")
  return (
    <div className={cn("flex h-full w-full items-center justify-center gap-2 text-muted-foreground", props.className)}>
      <Spinner className="size-5" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

/**
 * Shared Monaco Editor wrapper.
 *
 * `@monaco-editor/react` shows a plain "Loading..." text by default; we override
 * it here so all Monaco instances get a consistent app-wide loader.
 */
export function MaiaMonacoEditor(props: EditorProps & { loadingLabel?: string }) {
  const { loading, loadingLabel, ...rest } = props
  const i18n = useI18nOptional()

  // Keep Monaco workflow completions localized whenever i18n is available.
  React.useEffect(() => {
    if (!i18n) return
    setWorkflowCompletionMessages(i18n.messages)
  }, [i18n])

  return <Editor loading={loading ?? <DefaultMonacoLoading label={loadingLabel} />} {...rest} />
}
