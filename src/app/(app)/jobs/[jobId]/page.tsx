import JobDetailPage from "@/components/jobs/detail/job-detail-page"
import { requirePublicResource } from "@/lib/server/routing/require-public-resource"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"
import { prisma } from "@/lib/server/db"
import { requireAuthedUser } from "@/lib/server/auth/require"

export async function generateMetadata(props: { params: Promise<{ jobId: string }> }): Promise<Metadata> {
  await requireAuthedUser()
  const { jobId } = await props.params
  const { t } = await getT()
  const publicId = String(jobId || "")
    .trim()
    .toLowerCase()
  const job = await prisma.jobRun.findUnique({
    where: { publicId },
    select: { workflow: { select: { name: true } } },
  })

  if (!job) {
    return {
      title: t("nav.jobs"),
      description: t("jobs.recentJobsDescription"),
    }
  }

  const workflowName = typeof job.workflow?.name === "string" ? job.workflow.name.trim() : ""
  const title = workflowName ? `${workflowName} - ${t("nav.jobs")}` : t("nav.jobs")
  const description = t("jobs.recentJobsDescription")

  return {
    title,
    description,
  }
}

export default async function Page(props: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await props.params
  await requirePublicResource("job", jobId)
  return <JobDetailPage />
}
