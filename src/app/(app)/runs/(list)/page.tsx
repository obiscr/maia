import RunsPage from "@/components/runs/pages/runs-page"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("nav.runs"),
    description: t("runs.recentRunsDescription"),
  }
}

export default async function Page() {
  return <RunsPage />
}
