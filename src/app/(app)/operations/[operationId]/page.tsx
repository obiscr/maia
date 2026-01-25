import OperationDetailPage from "@/components/operations/detail/operation-detail-page"
import { requirePublicResource } from "@/lib/server/routing/require-public-resource"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"

export async function generateMetadata(props: { params: Promise<{ operationId: string }> }): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("operations.title"),
    description: t("operations.recentOperationsDescription"),
  }
}

export default async function Page(props: { params: Promise<{ operationId: string }> }) {
  const { operationId } = await props.params
  await requirePublicResource("operation", operationId)
  return <OperationDetailPage />
}
