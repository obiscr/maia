import { redirect } from "next/navigation"

import { requireAuthedUser } from "@/lib/server/auth/require"
import { normalizeRole } from "@/lib/shared/viewer"

export default async function Page() {
  const user = await requireAuthedUser()
  if (normalizeRole(user.role) !== "ADMIN") redirect("/preference")
  redirect("/admin/users")
}
