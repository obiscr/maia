import BatchesPage from "@/components/batches/pages/batches-page"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("nav.batches"),
    description: t("batches.recentBatchesDescription"),
  }
}

export default async function Page() {
  return <BatchesPage />
}
