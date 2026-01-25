import type { ReactNode } from "react"
import { redirect } from "next/navigation"

import { requireAuthedUser } from "@/lib/server/auth/require"

export default async function SystemSettingsLayout({ children }: { children: ReactNode }) {
  const user = await requireAuthedUser()
  if (String(user.role) !== "ADMIN") redirect("/preference")
  return children
}
