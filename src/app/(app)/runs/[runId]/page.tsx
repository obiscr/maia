import RunDetailClient from "@/components/runs/detail/run-detail-client"
import { requirePublicResource } from "@/lib/server/routing/require-public-resource"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"
import { prisma } from "@/lib/server/db"
import { requireAuthedUser } from "@/lib/server/auth/require"

export async function generateMetadata(props: { params: Promise<{ runId: string }> }): Promise<Metadata> {
  await requireAuthedUser()
  const { runId } = await props.params
  const { t } = await getT()
  const publicId = String(runId || "")
    .trim()
    .toLowerCase()
  const run = await prisma.run.findUnique({
    where: { publicId },
    select: { workflowName: true, status: true },
  })

  if (!run) {
    return {
      title: t("nav.runs"),
      description: t("runs.recentRunsDescription"),
    }
  }

  const workflowName = typeof run.workflowName === "string" ? run.workflowName.trim() : ""
  const title = workflowName ? `${workflowName} - ${t("nav.runs")}` : t("nav.runs")
  const description = t("runs.recentRunsDescription")

  return {
    title,
    description,
  }
}

export default async function RunDetailPage(props: { params: Promise<{ runId: string }> }) {
  const { runId } = await props.params
  const normalized = await requirePublicResource("run", runId)
  return <RunDetailClient runId={normalized} />
}
