import SchedulesPage from "@/components/schedules/pages/schedules-page"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"
import { requireAuthedUser } from "@/lib/server/auth/require"
import { normalizeRole } from "@/lib/shared/viewer"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("nav.schedules"),
    description: t("schedules.recentSchedulesDescription"),
  }
}

export default async function Page() {
  const user = await requireAuthedUser()
  return <SchedulesPage viewer={{ publicId: user.publicId, role: normalizeRole(user.role) }} />
}
