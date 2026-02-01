"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { LoadingState } from "@/components/common/loading-state"
import { MaiaLogo } from "@/components/maia-logo"
import { useI18n } from "@/components/i18n-provider"
import { apiFetchJson, ApiError } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"

export default function ConfirmEmailPage() {
  const { t } = useI18n()
  const router = useRouter()
  const searchParams = useSearchParams()

  React.useEffect(() => {
    let cancelled = false
    const token = String(searchParams.get("token") ?? "").trim()
    if (!token) {
      toast.error(t("errors.INVALID_LINK"))
      router.replace("/signin")
      return
    }

    async function run() {
      try {
        await apiFetchJson("/api/auth/email/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        })
        if (!cancelled) router.replace("/auth/redirect")
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.code === "TOKEN_EXPIRED") toast.error(t("errors.LINK_EXPIRED"))
          else toast.error(t("errors.INVALID_LINK"))
        } else {
          toast.error(t("errors.UNKNOWN_ERROR"))
        }
        if (!cancelled) router.replace("/signin")
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [router, searchParams, t])

  return (
    <LoadingState
      minHeightClassName="min-h-svh"
      order="text-top"
      logo={
        <div className="grid place-items-center overflow-hidden bg-background/40">
          <MaiaLogo className="size-12" title={t("app.name")} />
        </div>
      }
      textKey="auth.confirmEmail.loading"
      spinner
    />
  )
}
