import { AgentLandingPage } from "@/components/agent/agent-landing-page"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("common.entities.agent"),
    description: t("workflows.orchestrator.subtitleNew"),
  }
}

export default async function Page() {
  return <AgentLandingPage />
}
