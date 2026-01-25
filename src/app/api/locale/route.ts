import { DEFAULT_LOCALE, LOCALE_COOKIE_NAME, SUPPORTED_LOCALES } from "@/lib/shared/i18n/constants"
import { ok } from "@/lib/server/http/response"
import { mark, withApiObservability } from "@/lib/server/observability"

export const POST = withApiObservability(async (req: Request) => {
  const body = (await req.json().catch(() => ({}))) as { locale?: string }
  const nextLocale =
    body?.locale && (SUPPORTED_LOCALES as readonly string[]).includes(body.locale) ? body.locale : DEFAULT_LOCALE

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
