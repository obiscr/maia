import { isCurrentDatabaseSchemaReadySync } from "@/lib/server/db/schema-ready"
import { prismaMigrateDeploy } from "@/lib/server/db/prisma-migrate"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"

export const runtime = "nodejs"

/**
 * Initialize SQLite schema for first-run installs.
 *
 * This is intentionally triggered by the Setup wizard "Database" step,
 * so initialization aligns with user expectations (instead of happening implicitly later).
 */
export const POST = withApiObservability(async () => {
  const alreadyReady = isCurrentDatabaseSchemaReadySync()
  if (alreadyReady) return ok({ ok: true, alreadyReady: true })

  const migrated = await prismaMigrateDeploy()
  if (!migrated.ok) {
    const status = migrated.code === "MIGRATOR_REQUIRED" ? 409 : 500
    return fail({ status, code: migrated.code, meta: migrated.meta })
  }

  return ok({ ok: true, alreadyReady: false, migrated: true })
})
