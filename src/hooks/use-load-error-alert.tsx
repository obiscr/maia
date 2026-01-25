"use client"

import { ErrorAlert, type ErrorAlertAction } from "@/components/common/error-alert"

export function useLoadErrorAlert(
  loadError: unknown,
  actions?: ErrorAlertAction[],
  opts?: {
    titleKey?: string
    descriptionKey?: string
  },
) {
  if (!loadError) return null
  return (
    <ErrorAlert error={loadError} titleKey={opts?.titleKey} descriptionKey={opts?.descriptionKey} actions={actions} />
  )
}
