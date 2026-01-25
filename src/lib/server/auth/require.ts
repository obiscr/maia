import "server-only"

import { unstable_noStore as noStore } from "next/cache"
import { redirect } from "next/navigation"
import { cache } from "react"

import { prisma } from "@/lib/server/db"
import { getAuthedUserFromCookies } from "@/lib/server/auth/session"
import { getInstallation } from "@/lib/server/installation"
import { isCurrentDatabaseSchemaReadySync } from "@/lib/server/db/schema-ready"

const readAuthState = cache(async () => {
  const [inst, userCount, user] = await Promise.all([
    getInstallation().catch(() => null),
    prisma.user.count().catch(() => 0),
    getAuthedUserFromCookies().catch(() => null),
  ])
  return { inst, userCount, user }
})

/**
 * Enforce auth for server-rendered pages and server-side metadata.
 *
 * Rules:
 * - If the instance is not installed: redirect to /setup.
 * - If installed but no users exist: redirect to /setup/repair (break-glass recovery).
 * - If installed and users exist but no valid session: redirect to /auth/redirect.
 */
export async function requireAuthedUser() {
  // Ensure this never runs during static prerendering.
  noStore()

  // If schema isn't initialized yet, treat as not installed.
  if (!isCurrentDatabaseSchemaReadySync()) redirect("/setup")

  const { inst, userCount, user } = await readAuthState()

  const installed = Boolean(inst?.installedAt)
  if (!installed) redirect("/setup")
  if (userCount <= 0) redirect("/setup/repair")
  if (!user) redirect("/auth/redirect")
  return user
}

export async function getAuthedUserOrNull() {
  noStore()
  // If schema isn't initialized yet, treat as unauthenticated (e.g. /setup flow).
  if (!isCurrentDatabaseSchemaReadySync()) return null
  const { user } = await readAuthState()
  return user
}
