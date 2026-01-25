import type { Metadata } from "next"
import { redirect } from "next/navigation"

import AdminUsersPage from "@/components/admin/users/pages/admin-users-page"
import { requireAuthedUser } from "@/lib/server/auth/require"
import { getT } from "@/lib/server/i18n/server"
import { normalizeRole } from "@/lib/shared/viewer"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("admin.users.title"),
    description: t("admin.users.description"),
  }
}

export default async function Page() {
  const user = await requireAuthedUser()
  if (normalizeRole(user.role) !== "ADMIN") redirect("/preference")
  return <AdminUsersPage />
}
