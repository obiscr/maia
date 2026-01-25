import AgentSettingsPage from "@/components/settings/pages/agent-settings-page"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("common.entities.agent"),
    description: t("settings.agent.description"),
  }
}

export default async function Page() {
  return <AgentSettingsPage />
}
