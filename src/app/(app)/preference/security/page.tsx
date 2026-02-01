import type { Metadata } from "next"

import { getT } from "@/lib/server/i18n/server"
import SecuritySettingsPage from "@/components/settings/pages/security-settings-page"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("settings.security.title"),
    description: t("settings.security.description"),
  }
}

export default async function Page() {
  return <SecuritySettingsPage />
}
