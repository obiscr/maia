export const LOCALE_COOKIE_NAME = "maia_locale"

export const SUPPORTED_LOCALES = ["en", "zh-cn"] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = "en"
