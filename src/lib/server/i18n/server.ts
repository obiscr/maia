import { cookies } from "next/headers"

import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, SUPPORTED_LOCALES, type Locale } from "@/lib/shared/i18n/constants"
import { getMessages } from "@/lib/shared/i18n/messages"
import { createT } from "@/lib/shared/i18n/t"

export async function getLocaleFromCookies(): Promise<Locale> {
  const store = await cookies()
  const raw = store.get(LOCALE_COOKIE_NAME)?.value
  if (raw && (SUPPORTED_LOCALES as readonly string[]).includes(raw)) {
    return raw as Locale
  }
  return DEFAULT_LOCALE
}

export async function getT() {
  const locale = await getLocaleFromCookies()
  const messages = getMessages(locale)
  return { locale, t: createT(messages) }
}
