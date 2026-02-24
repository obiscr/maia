"use client"

import * as React from "react"
import { Copy, Ellipsis } from "lucide-react"
import { isToolUIPart, getToolName, type UIMessage } from "ai"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { toast } from "@/lib/client/toast"
import { sdkToCanonicalToolName, type ToolPartState } from "@/lib/shared/agent/tool-parts"

function toolStateLabel(state: string): string {
  switch (state as ToolPartState) {
    case "output-available":
      return "success"
    case "output-error":
      return "error"
    case "output-denied":
      return "denied"
    default:
      return "pending"
  }
}

/**
 * Serialize a UIMessage into a human-readable text representation
 * suitable for clipboard copy.  Includes markdown text and tool-call
 * annotations in a readable format.
 */
function serializeMessageForCopy(message: UIMessage): string {
  const segments: string[] = []

  for (const part of message.parts) {
    if (part.type === "text") {
      const text = part.text
      if (text.trim()) segments.push(text)
      continue
    }

    if (isToolUIPart(part)) {
      const sdkName = getToolName(part)
      const canonicalName = sdkToCanonicalToolName(sdkName)
      const state = (part as { state?: string }).state ?? ""
      const label = toolStateLabel(state)
      segments.push(`[ Tool call: ${canonicalName} → ${label} ]`)
      continue
    }
  }

  return segments.join("\n\n")
}

type MessageActionsProps = {
  message: UIMessage
  t: (k: string) => string
}

function MessageActionsImpl(props: MessageActionsProps) {
  const { message, t } = props

  const onCopy = React.useCallback(async () => {
    const text = serializeMessageForCopy(message)
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t("common.copied"))
    } catch {
      toast.error(t("common.copyActionFailed"))
    }
  }, [message, t])

  return (
    <div className="flex items-center justify-end p-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-6 text-muted-foreground hover:text-foreground">
            <Ellipsis className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-36">
          <DropdownMenuItem onSelect={() => void onCopy()}>
            <Copy className="size-4" />
            {t("common.copyAction")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export const MessageActions = React.memo(
  MessageActionsImpl,
  (prev, next) => prev.message === next.message && prev.t === next.t,
)
