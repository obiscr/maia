"use client"

import { useI18n } from "@/components/i18n-provider"
import { toast } from "@/lib/client/toast"
import { tApiError, tError } from "@/lib/shared/i18n/error"

export function useApiErrorToast() {
  const { t } = useI18n()

  function toastApiError(err: unknown, fallbackKey: string = "common.error") {
    toast.error(tApiError({ t, err, fallbackKey }))
  }

  function toastErrorCode(code?: string | null, fallbackKey: string = "common.error") {
    toast.error(tError({ t, code, fallbackKey }))
  }

  return { toastApiError, toastErrorCode }
}
