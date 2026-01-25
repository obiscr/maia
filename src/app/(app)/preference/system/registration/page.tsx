import type { Metadata } from "next"

import { getT } from "@/lib/server/i18n/server"
import { SystemRegistrationPage } from "@/components/settings/system/pages/system-registration-page"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: `${t("settings.system.title")} · ${t("settings.system.registration.sectionTitle")}`,
    description: t("settings.system.registration.hint"),
  }
}

export default async function Page() {
  return <SystemRegistrationPage />
}
