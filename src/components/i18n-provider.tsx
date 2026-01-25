"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"

import type { Locale } from "@/lib/shared/i18n/constants"
import { DEFAULT_LOCALE } from "@/lib/shared/i18n/constants"
import { getMessages, type Messages } from "@/lib/shared/i18n/messages"
import { createT, type TFunction, tOptional } from "@/lib/shared/i18n/t"
import { apiFetchJson } from "@/lib/shared/http/api"

type I18nContextValue = {
  locale: Locale
  messages: Messages
  t: TFunction
  tErrorCode: (code: string | null | undefined) => string | null
  setLocale: (locale: Locale) => Promise<void>
}

const I18nContext = React.createContext<I18nContextValue | null>(null)

export function useI18n() {
  const ctx = React.useContext(I18nContext)
  if (!ctx) throw new Error("useI18n must be used within I18nProvider")
  return ctx
}

/**
 * Optional i18n hook (does not throw if provider is missing).
 * Useful for shared UI primitives that want to display localized labels when available.
 */
export function useI18nOptional() {
  return React.useContext(I18nContext)
}

export function I18nProvider(props: { locale?: Locale; children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const initial = props.locale ?? DEFAULT_LOCALE
  const [locale, _setLocale] = React.useState<Locale>(initial)
  const messages = React.useMemo(() => getMessages(locale), [locale])
  const t = React.useMemo(() => createT(messages), [messages])

  const tErrorCode = React.useCallback(
    (code: string | null | undefined) => {
      const c = typeof code === "string" ? code.trim() : ""
      if (!c) return null
      return tOptional(messages, `errors.${c}`) ?? c
    },
    [messages],
  )

  const setLocale = React.useCallback(
    async (next: Locale) => {
      _setLocale(next)
      await apiFetchJson("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      }).catch(() => {})

      // Only refresh when the current page needs SSR re-evaluation for locale-dependent content
      // (notably: Home templates list, which is read on the server from `templates/<locale>/`).
      const shouldRefreshHomeTemplates =
        pathname === "/" && typeof document !== "undefined" && document.querySelector('[data-home-templates="1"]')
      if (shouldRefreshHomeTemplates) router.refresh()
    },
    [router, pathname],
  )

  const value = React.useMemo<I18nContextValue>(
    () => ({ locale, messages, t, tErrorCode, setLocale }),
    [locale, messages, t, tErrorCode, setLocale],
  )

  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>
}
