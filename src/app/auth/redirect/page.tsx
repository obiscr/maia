"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { LoadingState } from "@/components/common/loading-state"
import { MaiaLogo } from "@/components/maia-logo"
import { useI18n } from "@/components/i18n-provider"

type AuthStatus = {
  installed: boolean
  hasUsers: boolean
  user: unknown | null
}

const RETURN_TO_COOKIE_NAME = "maia_return_to"

function sanitizeNext(raw: string | null) {
  const v = String(raw ?? "").trim()
  if (!v) return "/"
  // Only allow same-origin relative paths.
  if (!v.startsWith("/")) return "/"
  if (v.startsWith("//")) return "/"
  return v
}

function readCookie(name: string) {
  if (typeof document === "undefined") return null
  const raw = document.cookie ?? ""
  const parts = raw.split(";")
  for (const p of parts) {
    const [k, ...rest] = p.trim().split("=")
    if (!k) continue
    if (k !== name) continue
    return rest.join("=") || ""
  }
  return null
}

function clearCookie(name: string) {
  if (typeof document === "undefined") return
  document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax`
}

export default function AuthRedirectPage() {
  const { t } = useI18n()
  const router = useRouter()
  const searchParams = useSearchParams()

  React.useEffect(() => {
    let cancelled = false
    const fromQuery = searchParams.get("next")
    const fromCookie = !fromQuery ? readCookie(RETURN_TO_COOKIE_NAME) : null
    const next = sanitizeNext(fromQuery ?? (fromCookie ? decodeURIComponent(fromCookie) : null))
    clearCookie(RETURN_TO_COOKIE_NAME)

    async function run() {
      try {
        const res = await fetch("/api/auth/status", { method: "GET", cache: "no-store" })
        const json = (await res.json().catch(() => ({}))) as Partial<AuthStatus>

        if (cancelled) return

        const installed = Boolean(json.installed)
        const hasUsers = Boolean(json.hasUsers)
        const user = json.user ?? null

        if (!installed) {
          router.replace("/setup")
          return
        }
        if (!hasUsers) {
          router.replace("/setup/repair")
          return
        }
        if (!user) {
          router.replace(`/signin?next=${encodeURIComponent(next)}`)
          return
        }

        router.replace(next)
      } catch {
        if (!cancelled) router.replace(`/signin?next=${encodeURIComponent(next)}`)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [router, searchParams])

  return (
    <LoadingState
      minHeightClassName="min-h-svh"
      order="text-top"
      logo={
        <div className="grid place-items-center overflow-hidden bg-background/40">
          <MaiaLogo className="size-12" title={t("app.name")} />
        </div>
      }
      textKey="auth.redirect.loading"
      spinner
    />
  )
}
