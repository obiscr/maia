import WorkflowsPage from "@/components/workflows/pages/workflows-page"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("workflows.title"),
    description: t("workflows.listDescription"),
  }
}

export default async function Page() {
  return <WorkflowsPage />
}
