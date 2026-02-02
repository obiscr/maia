import type { Metadata } from "next"

import { getT } from "@/lib/server/i18n/server"
import { SystemOpsPage } from "@/components/settings/system/pages/system-ops-page"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: `${t("settings.system.title")} · ${t("settings.system.ops.sectionTitle")}`,
    description: t("settings.system.ops.hint"),
  }
}

export default async function Page() {
  return <SystemOpsPage />
}
