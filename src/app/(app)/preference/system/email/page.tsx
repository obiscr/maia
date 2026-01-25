import type { Metadata } from "next"

import { getT } from "@/lib/server/i18n/server"
import { SystemEmailPage } from "@/components/settings/system/pages/system-email-page"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: `${t("settings.system.title")} · ${t("settings.system.email.sectionTitle")}`,
    description: t("settings.system.email.enableActionHint"),
  }
}

export default async function Page() {
  return <SystemEmailPage />
}
