import type { Metadata } from "next"

import { getT } from "@/lib/server/i18n/server"
import GeneralSettingsPage from "../../../../components/settings/pages/general-settings-page"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("settings.general.title"),
    description: t("settings.general.description"),
  }
}

export default async function Page() {
  return <GeneralSettingsPage />
}
