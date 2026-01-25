"use client"

import * as React from "react"

import { useI18nOptional } from "@/components/i18n-provider"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

type LoadingStateOrder = "icon-top" | "text-top"
type LoadingStatePlacement = "center" | "top"

export function LoadingState(props: {
  textKey?: string
  text?: React.ReactNode
  icon?: React.ReactNode
  spinner?: boolean
  spinnerClassName?: string
  logo?: React.ReactNode
  order?: LoadingStateOrder
  placement?: LoadingStatePlacement
  className?: string
  contentClassName?: string
  minHeightClassName?: string
}) {
  const i18n = useI18nOptional()
  const order: LoadingStateOrder = props.order ?? "icon-top"
  const placement: LoadingStatePlacement = props.placement ?? "center"

  const label = props.text ?? (props.textKey ? (i18n ? i18n.t(props.textKey) : "Loading…") : null)

  const fallbackLabel = props.textKey
    ? i18n
      ? i18n.t(props.textKey)
      : "Loading…"
    : i18n
      ? i18n.t("common.loading")
      : "Loading…"
  const ariaLabel = typeof label === "string" ? label : fallbackLabel

  const iconNode =
    props.icon ??
    (props.spinner ? (
      <Spinner className={cn("size-10 text-muted-foreground", props.spinnerClassName)} aria-label={ariaLabel} />
    ) : null)

  const hasContent = Boolean(props.logo || iconNode || label)
  if (!hasContent) return null

  return (
    <div
      className={cn(
        "flex w-full justify-center p-6",
        placement === "center" ? "items-center" : "items-start pt-16",
        props.minHeightClassName ?? "min-h-[40vh]",
        props.className,
      )}
    >
      <div className={cn("flex w-full max-w-lg flex-col items-center gap-4", props.contentClassName)}>
        {props.logo ? <div className="shrink-0">{props.logo}</div> : null}

        {order === "icon-top" ? (
          <>
            {iconNode ? <div className="shrink-0">{iconNode}</div> : null}
            {label ? <div className="text-center text-base text-muted-foreground">{label}</div> : null}
          </>
        ) : (
          <>
            {label ? <div className="text-center text-base text-muted-foreground">{label}</div> : null}
            {iconNode ? <div className="shrink-0">{iconNode}</div> : null}
          </>
        )}
      </div>
    </div>
  )
}
