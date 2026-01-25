import ScheduleDetailPage from "@/components/schedules/detail/schedule-detail-page"
import { requirePublicResource } from "@/lib/server/routing/require-public-resource"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"
import { prisma } from "@/lib/server/db"
import { requireAuthedUser } from "@/lib/server/auth/require"

export async function generateMetadata(props: { params: Promise<{ scheduleId: string }> }): Promise<Metadata> {
  await requireAuthedUser()
  const { scheduleId } = await props.params
  const { t } = await getT()
  const publicId = String(scheduleId || "")
    .trim()
    .toLowerCase()
  const schedule = await prisma.schedule.findUnique({
    where: { publicId },
    select: {
      name: true,
      workflow: { select: { name: true } },
    },
  })

  if (!schedule) {
    return {
      title: t("nav.schedules"),
      description: t("schedules.recentSchedulesDescription"),
    }
  }

  const scheduleName = typeof schedule.name === "string" ? schedule.name.trim() : ""
  const workflowName = typeof schedule.workflow?.name === "string" ? schedule.workflow.name.trim() : ""
  const titlePrefix = scheduleName || workflowName
  const title = titlePrefix ? `${titlePrefix} - ${t("nav.schedules")}` : t("nav.schedules")
  const description = t("schedules.recentSchedulesDescription")

  return {
    title,
    description,
  }
}

export default async function Page(props: { params: Promise<{ scheduleId: string }> }) {
  const { scheduleId } = await props.params
  await requirePublicResource("schedule", scheduleId)
  return <ScheduleDetailPage />
}
