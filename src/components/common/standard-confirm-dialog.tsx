"use client"

import * as React from "react"
import { Check, Trash2, X } from "lucide-react"

import { ConfirmAlertDialog } from "@/components/common/confirm-alert-dialog"
import { useI18n } from "@/components/i18n-provider"

export type StandardConfirmDialogKind = "default" | "delete"

export type StandardConfirmDialogProps = {
  kind?: StandardConfirmDialogKind
  open: boolean
  onOpenChange: (open: boolean) => void
  pending?: boolean

  title: string
  description?: React.ReactNode

  confirmText?: string
  cancelText?: string

  onConfirm: () => void | Promise<void>

  /** Optional overrides */
  confirmIcon?: React.ReactNode
  cancelIcon?: React.ReactNode
  confirmVariant?: "default" | "destructive"
}

/**
 * StandardConfirmDialog
 * A thin, reusable wrapper around ConfirmAlertDialog that provides sensible defaults
 * (labels/icons/variant) based on `kind`.
 */
export function StandardConfirmDialog(props: StandardConfirmDialogProps) {
  const { t } = useI18n()
  const kind = props.kind ?? "default"

  const confirmVariant = props.confirmVariant ?? (kind === "delete" ? "destructive" : "default")
  const confirmIcon =
    props.confirmIcon ??
    (kind === "delete" ? (
      <Trash2 className="h-4 w-4" aria-hidden="true" />
    ) : (
      <Check className="h-4 w-4" aria-hidden="true" />
    ))
  const cancelIcon = props.cancelIcon ?? <X className="h-4 w-4" aria-hidden="true" />

  const confirmText =
    props.confirmText ??
    (kind === "delete" ? (props.pending ? t("common.deleting") : t("common.deleteAction")) : t("common.confirmAction"))

  return (
    <ConfirmAlertDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      description={props.description}
      confirmText={confirmText}
      cancelText={props.cancelText ?? t("common.cancelAction")}
      confirmIcon={confirmIcon}
      cancelIcon={cancelIcon}
      confirmVariant={confirmVariant}
      onConfirm={props.onConfirm}
      pending={props.pending}
    />
  )
}

export function StandardDeleteDialog(props: Omit<StandardConfirmDialogProps, "kind" | "confirmVariant">) {
  return <StandardConfirmDialog {...props} kind="delete" confirmVariant="destructive" />
}
