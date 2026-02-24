import OperationsPage from "@/components/operations/pages/operations-page"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("operations.title"),
    description: t("operations.recentOperationsDescription"),
  }
}

export default async function Page() {
  return <OperationsPage />
}
