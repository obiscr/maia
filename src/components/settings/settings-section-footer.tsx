"use client"

import type { ReactNode } from "react"
import { RefreshCcw, Save } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

export function SettingsSectionFooter(props: {
  className?: string

  leftClassName?: string
  rightClassName?: string

  onReset?: () => void
  resetDisabled?: boolean
  resetLabel?: ReactNode

  saveType?: "button" | "submit"
  onSave?: () => void
  saveDisabled?: boolean
  saveLabel?: ReactNode
  saving?: boolean
  savingLabel?: ReactNode
}) {
  const showReset = typeof props.onReset === "function"
  const showSave = props.saveType === "submit" || typeof props.onSave === "function"

  if (!showReset && !showSave) return null

  return (
    <div className={cn("space-y-3", props.className)}>
      <Separator />
      <div className={cn("flex flex-col-reverse gap-2", "sm:flex-row sm:items-center sm:justify-between")}>
        <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center", props.leftClassName)}>
          {showReset ? (
            <Button size="sm" type="button" variant="ghost" onClick={props.onReset} disabled={props.resetDisabled}>
              <RefreshCcw className="size-4" aria-hidden="true" />
              {props.resetLabel}
            </Button>
          ) : null}
        </div>
        <div
          className={cn(
            "flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end",
            props.rightClassName,
          )}
        >
          {showSave ? (
            <Button
              size="sm"
              type={props.saveType ?? "button"}
              onClick={props.saveType === "submit" ? undefined : props.onSave}
              disabled={props.saveDisabled}
            >
              {props.saving ? (
                <Spinner className="size-4" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              {props.saving ? props.savingLabel : props.saveLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
