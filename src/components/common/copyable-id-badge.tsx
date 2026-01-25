"use client"

import * as React from "react"
import { Copy } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { useI18n } from "@/components/i18n-provider"
import { copyTextToClipboard } from "@/lib/client/clipboard"
import { toast } from "@/lib/client/toast"
import { cn } from "@/lib/utils"
import { ShortId } from "@/components/common/short-id"
import { formatPublicIdForDisplay, looksLikePublicId } from "@/lib/shared/format/id"

export function CopyableIdBadge(props: {
  id: string | null | undefined
  label?: string
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  className?: string
  /** If true, show a small copy icon in the badge. Defaults to false (icon-only = entity icon). */
  showCopyIcon?: boolean
  /** Override what gets copied; defaults to the full id string. */
  copyValue?: string
  /** ShortId props */
  head?: number
  tail?: number
  minLength?: number
}) {
  const { t } = useI18n()
  const full = typeof props.id === "string" ? props.id : props.id == null ? "" : String(props.id)
  const canCopy = !!full.trim()
  const display = formatPublicIdForDisplay(full)
  const defaultCopyValue = looksLikePublicId(full) ? display : full
  const labelText = typeof props.label === "string" && props.label.trim().length > 0 ? props.label.trim() : null

  async function doCopy(e: React.MouseEvent | React.KeyboardEvent) {
    // This badge often lives inside a row-level <Link>. Prevent navigation.
    e.preventDefault()
    e.stopPropagation()
    if (!canCopy) return
    try {
      await copyTextToClipboard(props.copyValue ?? defaultCopyValue)
      toast(t("common.copied"))
    } catch {
      toast.error(t("common.copyActionFailed"))
    }
  }

  return (
    <Badge asChild variant="outline" className={cn("h-5 px-2 font-mono text-[11px]", props.className)}>
      <span
        role={canCopy ? "button" : undefined}
        tabIndex={canCopy ? 0 : undefined}
        className={cn(
          "inline-flex items-center gap-1 select-none",
          canCopy ? "cursor-pointer hover:bg-muted/50" : "cursor-default",
        )}
        title={
          canCopy ? `${labelText ? `${labelText}: ` : ""}${display} (${t("common.copyActionIdAction")})` : (labelText ?? display)
        }
        onClick={doCopy}
        onKeyDown={(e) => {
          if (!canCopy) return
          if (e.key === "Enter" || e.key === " ") void doCopy(e)
        }}
      >
        <props.Icon className="size-3" aria-hidden={true} />
        {labelText ? <span>{labelText}</span> : null}
        <ShortId id={full} head={props.head} tail={props.tail} minLength={props.minLength} />
        {props.showCopyIcon ? <Copy className="size-3 opacity-70" aria-hidden={true} /> : null}
      </span>
    </Badge>
  )
}
