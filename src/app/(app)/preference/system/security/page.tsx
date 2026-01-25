import type { Metadata } from "next"

import { getT } from "@/lib/server/i18n/server"
import { SystemSecurityPage } from "@/components/settings/system/pages/system-security-page"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: `${t("settings.system.title")} · ${t("settings.system.security.sectionTitle")}`,
    description: t("settings.system.security.hint"),
  }
}

export default async function Page() {
  return <SystemSecurityPage />
}
