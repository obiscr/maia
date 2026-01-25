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

export function ConfirmAlertDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  confirmText?: string
  cancelText?: string
  confirmIcon?: React.ReactNode
  cancelIcon?: React.ReactNode
  confirmVariant?: "default" | "destructive"
  onConfirm: () => void | Promise<void>
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
  return (
    <AlertDialog open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          {desc}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={props.pending}>
            <span className="inline-flex items-center gap-2">
              {props.cancelIcon}
              <span>{props.cancelText ?? t("common.cancelAction")}</span>
            </span>
          </AlertDialogCancel>
          <AlertDialogAction
            className={
              props.confirmVariant === "destructive"
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
            disabled={props.pending}
            onClick={(e) => {
              e.preventDefault()
              void props.onConfirm()
            }}
          >
            <span className="inline-flex items-center gap-2">
              {props.pending && props.confirmIcon ? (
                <Spinner className="h-4 w-4" aria-hidden="true" />
              ) : (
                props.confirmIcon
              )}
              <span>{props.confirmText ?? t("common.confirmAction")}</span>
            </span>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
