import { ensureCurrentSqliteSchemaReady } from "@/lib/server/db/ensure-schema"
import { isCurrentDatabaseSchemaReadySync } from "@/lib/server/db/schema-ready"
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

  const migratedOk = await ensureCurrentSqliteSchemaReady()
    .then(() => true)
    .catch(() => false)
  if (!migratedOk) return fail({ status: 500, code: "SQLITE_MIGRATION_FAILED" })
  return ok({ ok: true, alreadyReady: false })
})
