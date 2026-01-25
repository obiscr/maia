import type { Metadata } from "next"

import { getT } from "@/lib/server/i18n/server"
import { SystemRetentionPage } from "@/components/settings/system/pages/system-retention-page"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: `${t("settings.system.title")} · ${t("settings.system.retention.sectionTitle")}`,
    description: t("settings.system.retention.hint"),
  }
}

export default async function Page() {
  return <SystemRetentionPage />
}
