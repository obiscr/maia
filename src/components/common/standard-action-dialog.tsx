"use client"

import * as React from "react"
import { X } from "lucide-react"

import { ActionAlertDialog, type ActionAlertDialogAction } from "@/components/common/action-alert-dialog"
import { useI18n } from "@/components/i18n-provider"

export type StandardActionDialogAction = Omit<ActionAlertDialogAction, "label"> & {
  label?: string
}

export type StandardActionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending?: boolean
  title: string
  titleIcon?: React.ReactNode
  description?: React.ReactNode
  actions: StandardActionDialogAction[]
}

/**
 * StandardActionDialog
 * Wraps ActionAlertDialog with:
 * - default cancel action label/icon
 * - consistent behavior across pages
 */
export function StandardActionDialog(props: StandardActionDialogProps) {
  const { t } = useI18n()
  const actions: ActionAlertDialogAction[] = (props.actions ?? []).map((a) => ({
    ...a,
    label: a.label ?? (a.kind === "cancel" ? t("common.cancelAction") : t("common.confirmAction")),
    icon: a.kind === "cancel" && !a.icon ? <X className="h-4 w-4" aria-hidden="true" /> : a.icon,
  }))

  return (
    <ActionAlertDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      titleIcon={props.titleIcon}
      description={props.description}
      actions={actions}
      pending={props.pending}
    />
  )
}
