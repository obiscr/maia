"use client"

import type { ComponentProps, ReactNode } from "react"

import { AlertCircleIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import { tApiError, tError } from "@/lib/shared/i18n/error"
import { isRecord } from "@/lib/shared/lang/is-record"
import { cn } from "@/lib/utils"

function readStatus(err: unknown): number | string | undefined {
  if (!isRecord(err)) return undefined
  const s = err.status
  if (typeof s === "number") return s
  if (typeof s === "string" && s.trim()) return s.trim()
  return undefined
}

export type ErrorAlertAction = {
  key: string
  label?: string
  /** Optional i18n key for the label (used when `label` not provided). */
  labelKey?: string
  icon?: ReactNode
  variant?: ComponentProps<typeof Button>["variant"]
  size?: ComponentProps<typeof Button>["size"]
  disabled?: boolean
  onClick?: () => void | Promise<void>
}

export function ErrorAlert(props: {
  code?: string | null
  error?: unknown
  titleKey?: string // optional i18n key
  descriptionKey?: string // optional i18n key
  description?: ReactNode
  actions?: ErrorAlertAction[]
  /** Maps directly to `Alert` variants (no custom styling). */
  variant?: "destructive" | "default"
  className?: string
  children?: ReactNode
}) {
  const { t } = useI18n()
  const status = readStatus(props.error)
  const titleVars =
    typeof status === "number" || (typeof status === "string" && String(status).trim().length) ? { status } : undefined
  const title = props.titleKey ? t(props.titleKey, titleVars) : t("common.error")
  const desc =
    props.description ??
    (props.descriptionKey
      ? t(props.descriptionKey)
      : props.error
        ? tApiError({ t, err: props.error, fallbackKey: "common.error" })
        : tError({ t, code: props.code, fallbackKey: "common.error" }))
  const titleText = String(title ?? "").trim()
  const descText = typeof desc === "string" ? desc.trim() : ""
  const showDescription = desc ? (typeof desc === "string" ? !!descText && descText !== titleText : true) : false
  const variant = props.variant ?? "destructive"
  const actions = (props.actions ?? []).filter(Boolean)
  const showBody = showDescription || !!props.children || actions.length > 0

  return (
    <Alert variant={variant} className={cn("rounded-md", props.className)}>
      <AlertCircleIcon />
      <AlertTitle>
        <span className="min-w-0 break-words">{title}</span>
      </AlertTitle>
      {showBody ? (
        <AlertDescription>
          {showDescription ? desc : null}
          {props.children ? <div className={showDescription ? "mt-2" : undefined}>{props.children}</div> : null}
          {actions.length ? (
            <div className={showDescription || props.children ? "mt-1 flex flex-wrap gap-2" : "flex flex-wrap gap-2"}>
              {actions.map((a) => {
                const label = a.label ?? (a.labelKey ? t(a.labelKey) : "")
                if (!String(label || "").trim()) return null
                return (
                  <Button
                    key={a.key}
                    variant={a.variant ?? "secondary"}
                    size={a.size ?? "sm"}
                    disabled={a.disabled}
                    onClick={() => void a.onClick?.()}
                  >
                    <span className="inline-flex items-center gap-2">
                      {a.icon}
                      <span>{label}</span>
                    </span>
                  </Button>
                )
              })}
            </div>
          ) : null}
        </AlertDescription>
      ) : null}
    </Alert>
  )
}
