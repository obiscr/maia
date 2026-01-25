"use client"

import * as React from "react"

export type UseStandardDialogOptions = {
  initialOpen?: boolean
  /**
   * If true (default), calling `confirm()` will close the dialog after the action succeeds.
   * If the action throws/rejects, the dialog stays open.
   */
  closeOnConfirm?: boolean
}

export type UseStandardDialogResult = {
  open: boolean
  pending: boolean
  setOpen: (open: boolean) => void
  setPending: (pending: boolean) => void
  onOpenChange: (open: boolean) => void
  openDialog: () => void
  closeDialog: () => void
  /**
   * Run an async action with pending state and optional auto-close.
   * Safe against double-submit; if already pending, it no-ops.
   */
  confirm: (action: () => void | boolean | Promise<void | boolean>) => Promise<boolean>
}

/**
 * useStandardDialog
 * Standardizes dialog open/pending state handling across the app.
 */
export function useStandardDialog(opts: UseStandardDialogOptions = {}): UseStandardDialogResult {
  const { initialOpen = false, closeOnConfirm = true } = opts
  const [open, setOpen] = React.useState<boolean>(initialOpen)
  const [pending, setPending] = React.useState<boolean>(false)

  const closeDialog = React.useCallback(() => setOpen(false), [])
  const openDialog = React.useCallback(() => setOpen(true), [])

  const onOpenChange = React.useCallback(
    (next: boolean) => {
      // Prevent closing while pending (avoids accidental dismissal mid-request).
      if (!next && pending) return
      setOpen(next)
    },
    [pending],
  )

  const confirm = React.useCallback(
    async (action: () => void | boolean | Promise<void | boolean>) => {
      if (pending) return false
      setPending(true)
      try {
        const res = await action()
        const ok = res !== false
        if (ok && closeOnConfirm) setOpen(false)
        return ok
      } catch {
        return false
      } finally {
        setPending(false)
      }
    },
    [closeOnConfirm, pending],
  )

  return {
    open,
    pending,
    setOpen,
    setPending,
    onOpenChange,
    openDialog,
    closeDialog,
    confirm,
  }
}
