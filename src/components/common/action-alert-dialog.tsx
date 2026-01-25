"use client"

import * as React from "react"

import { useI18n } from "@/components/i18n-provider"
import { Spinner } from "@/components/ui/spinner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export type ActionAlertDialogAction = {
  key: string
  label: string
  icon?: React.ReactNode
  variant?: "default" | "destructive"
  kind?: "action" | "cancel"
  disabled?: boolean
  onClick?: () => void | Promise<void>
}

export function ActionAlertDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  titleIcon?: React.ReactNode
  description?: React.ReactNode
  actions: ActionAlertDialogAction[]
  pending?: boolean
}) {
  const { t } = useI18n()
  const desc =
    typeof props.description === "string" ? (
      <AlertDialogDescription>{props.description}</AlertDialogDescription>
    ) : props.description ? (
      // Radix Description renders a <p>; use asChild to avoid invalid <div> inside <p>.
      <AlertDialogDescription asChild>
        <div>{props.description}</div>
      </AlertDialogDescription>
    ) : null
  const actions = (props.actions ?? []).slice(0, 3)
  const cancelAction = actions.find((a) => a.kind === "cancel") ?? null
  const otherActions = actions.filter((a) => a.kind !== "cancel")

  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <span className="inline-flex items-center gap-2">
              {props.titleIcon}
              <span>{props.title}</span>
            </span>
          </AlertDialogTitle>
          {desc}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={props.pending || cancelAction?.disabled}>
            <span className="inline-flex items-center gap-2">
              {cancelAction?.icon}
              <span>{cancelAction?.label ?? t("common.cancelAction")}</span>
            </span>
          </AlertDialogCancel>
          {otherActions.map((a) => (
            <AlertDialogAction
              key={a.key}
              className={
                a.variant === "destructive"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
              disabled={props.pending || a.disabled}
              onClick={(e) => {
                e.preventDefault()
                void a.onClick?.()
              }}
            >
              <span className="inline-flex items-center gap-2">
                {props.pending && otherActions.length === 1 && a.icon ? (
                  <Spinner className="h-4 w-4" aria-hidden="true" />
                ) : (
                  a.icon
                )}
                <span>{a.label}</span>
              </span>
            </AlertDialogAction>
          ))}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
