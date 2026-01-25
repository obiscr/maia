import RunsPage from "@/components/runs/pages/runs-page"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"
import { requireAuthedUser } from "@/lib/server/auth/require"
import { normalizeRole } from "@/lib/shared/viewer"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("nav.runs"),
    description: t("runs.recentRunsDescription"),
  }
}

export default async function Page() {
  const user = await requireAuthedUser()
  return <RunsPage viewer={{ publicId: user.publicId, role: normalizeRole(user.role) }} />
}

