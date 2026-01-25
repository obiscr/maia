import SettingsPage from "@/components/settings/pages/settings-page"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("sidebar.preferences"),
    description: t("settings.description"),
  }
}

export default async function Page() {
  return <SettingsPage />
}
