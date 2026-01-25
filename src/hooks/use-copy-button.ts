"use client"

import * as React from "react"
import { useI18n } from "@/components/i18n-provider"
import { toast } from "@/lib/client/toast"
import { copyTextToClipboard } from "@/lib/client/clipboard"

/**
 * Hook for copy button with checkmark feedback.
 * Returns copied state and a handler function.
 * Matches the behavior used in WorkflowIdField.
 */
export function useCopyButton() {
  const { t } = useI18n()
  const [copied, setCopied] = React.useState(false)
  const timerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleCopy = React.useCallback(
    async (text: string) => {
      try {
        await copyTextToClipboard(text)
        toast(t("common.copied"))
        setCopied(true)
        if (timerRef.current) window.clearTimeout(timerRef.current)
        timerRef.current = window.setTimeout(() => {
          setCopied(false)
          timerRef.current = null
        }, 1200)
      } catch {
        toast.error(t("common.copyActionFailed"))
      }
    },
    [t],
  )

  return { copied, handleCopy }
}
