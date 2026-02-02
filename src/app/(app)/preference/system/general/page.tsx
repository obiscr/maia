import type { Metadata } from "next"

import { getT } from "@/lib/server/i18n/server"
import { SystemGeneralPage } from "@/components/settings/system/pages/system-general-page"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: `${t("settings.system.title")} · ${t("settings.system.general.sectionTitle")}`,
    description: t("settings.system.general.hint"),
  }
}

export default async function Page() {
  return <SystemGeneralPage />
}
