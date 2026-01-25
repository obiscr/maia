import BatchDetailPage from "@/components/batches/detail/batch-detail-page"
import { requirePublicResource } from "@/lib/server/routing/require-public-resource"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"
import { prisma } from "@/lib/server/db"
import { requireAuthedUser } from "@/lib/server/auth/require"

export async function generateMetadata(props: { params: Promise<{ batchId: string }> }): Promise<Metadata> {
  await requireAuthedUser()
  const { batchId } = await props.params
  const { t } = await getT()
  const publicId = String(batchId || "")
    .trim()
    .toLowerCase()
  const batch = await prisma.batch.findUnique({
    where: { publicId },
    select: { name: true },
  })

  if (!batch) {
    return {
      title: t("nav.batches"),
      description: t("batches.recentBatchesDescription"),
    }
  }

  const title = `${batch.name} - ${t("nav.batches")}`
  const description = t("batches.recentBatchesDescription")

  return {
    title,
    description,
  }
}

export default async function Page(props: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await props.params
  await requirePublicResource("batch", batchId)
  return <BatchDetailPage />
}
