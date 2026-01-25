import type { Metadata } from "next"

import { getT } from "@/lib/server/i18n/server"
import { SystemPerformancePage } from "@/components/settings/system/pages/system-performance-page"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: `${t("settings.system.title")} · ${t("settings.system.performance.sectionTitle")}`,
    description: t("settings.system.advanced.hint"),
  }
}

export default async function Page() {
  return <SystemPerformancePage />
}
