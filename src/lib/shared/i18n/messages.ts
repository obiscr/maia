import type { Locale } from "@/lib/shared/i18n/constants"

import en from "@/lib/shared/i18n/en.json"
import zhCn from "@/lib/shared/i18n/zh-cn.json"

export interface Messages {
  [key: string]: string | Messages
}

export const MESSAGES: Record<Locale, Messages> = {
  en: en as Messages,
  "zh-cn": zhCn as Messages,
}

export function getMessages(locale: Locale) {
  return MESSAGES[locale]
}
