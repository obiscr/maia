import { prisma } from "@/lib/server/db"
import { ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { getInstallation } from "@/lib/server/installation"
import { isCurrentDatabaseSchemaReadySync } from "@/lib/server/db/schema-ready"

export const runtime = "nodejs"

export const GET = withApiObservability(async (req: Request) => {
  if (!isCurrentDatabaseSchemaReadySync()) {
    // Before schema exists, treat as not installed and avoid Prisma queries.
    return ok({ installed: false, registrationMode: "DISABLED", hasUsers: false, user: null })
  }

  const [inst, userCount, user] = await Promise.all([
    getInstallation().catch(() => null),
    prisma.user.count().catch(() => 0),
    getAuthedUserFromRequest(req).catch(() => null),
  ])
  const installed = Boolean(inst?.installedAt)
  return ok({
    installed,
    registrationMode: inst?.registrationMode ?? "DISABLED",
    hasUsers: userCount > 0,
    user,
  })
})
