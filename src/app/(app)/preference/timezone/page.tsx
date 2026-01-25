import type { Metadata } from "next"

import { getT } from "@/lib/server/i18n/server"
import TimezoneSettingsPage from "@/components/settings/pages/timezone-settings-page"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("settings.timezone.title"),
    description: t("settings.timezone.description"),
  }
}

export default async function Page() {
  return <TimezoneSettingsPage />
}

