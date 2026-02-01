"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { LoadingState } from "@/components/common/loading-state"
import { MaiaLogo } from "@/components/maia-logo"
import { useI18n } from "@/components/i18n-provider"
import { apiFetchJson, ApiError } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"

export default function MagicLinkConsumePage() {
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
        await apiFetchJson("/api/auth/magic/consume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        })
        if (!cancelled) router.replace("/auth/redirect")
      } catch (err) {
        if (err instanceof ApiError && err.code === "TOTP_REQUIRED") {
          const challengeId = typeof err.meta?.challengeId === "string" ? String(err.meta.challengeId) : ""
          if (challengeId) {
            try {
              sessionStorage.setItem("maia_pending_challenge", challengeId)
              // Best-effort: we don't know email here in all cases; keep empty.
              sessionStorage.setItem("maia_pending_email", "")
            } catch {}
            if (!cancelled) router.replace("/otp")
            return
          }
        }
        if (err instanceof ApiError && err.code === "TOKEN_EXPIRED") toast.error(t("errors.LINK_EXPIRED"))
        else toast.error(t("errors.INVALID_LINK"))
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
      textKey="auth.magicConsume.loading"
      spinner
    />
  )
}
