import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, SUPPORTED_LOCALES, type Locale } from "@/lib/shared/i18n/constants"
import { ok } from "@/lib/server/http/response"
import { mark, withApiObservability } from "@/lib/server/observability"
import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { setLastSeenUiLocaleForUser } from "@/lib/server/settings/outbound-language-settings"

export const POST = withApiObservability(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as { locale?: string }
  const nextLocale: Locale =
    body?.locale && (SUPPORTED_LOCALES as readonly string[]).includes(body.locale)
      ? (body.locale as Locale)
      : DEFAULT_LOCALE

  // Best-effort: if the request is authenticated, persist last-seen UI locale for outbound "auto".
  // (No auth required; skip silently when unauthenticated.)
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (user) {
    void setLastSeenUiLocaleForUser({ userId: user.id, locale: nextLocale }).catch(() => {})
  }

  mark("parse")
  const res = ok({ ok: true, locale: nextLocale })
  res.cookies.set({
    name: LOCALE_COOKIE_NAME,
    value: nextLocale,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })
  return res
})
