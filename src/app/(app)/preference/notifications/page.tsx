import type { Metadata } from "next"

import { getT } from "@/lib/server/i18n/server"
import NotificationsSettingsPage from "@/components/settings/pages/notifications-settings-page"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: `${t("sidebar.preferences")} · ${t("settings.notifications.title")}`,
    description: t("settings.notifications.description"),
  }
}

export default async function Page() {
  return <NotificationsSettingsPage />
}
