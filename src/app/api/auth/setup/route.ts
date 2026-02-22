import crypto from "node:crypto"
import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { isCurrentDatabaseSchemaReadySync } from "@/lib/server/db/schema-ready"
import { fail, ok } from "@/lib/server/http/response"
import { withApiObservability } from "@/lib/server/observability"
import { allocatePublicId } from "@/lib/server/public-ids"
import { hashPassword } from "@/lib/server/auth/password"
import { createSession, cookieHeaderForSession, getSessionCookieSecure } from "@/lib/server/auth/session"
import { checkRateLimit, getClientIp, RATE_LIMIT_CONFIG } from "@/lib/server/auth/rate-limit"
import { getInstallation, ensureInstallationRowTx } from "@/lib/server/installation"
import { zodIssues } from "@/lib/shared/http/zod"

export const runtime = "nodejs"

const setupSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(256),
  name: z.string().trim().max(200).optional(),
})

export const POST = withApiObservability(async (req: Request) => {
  const clientIp = getClientIp(req)
  {
    // Setup should be rare; keep a generous but protective limit.
    const rl = checkRateLimit({
      key: `auth:setup:ip:${clientIp}`,
      limit: RATE_LIMIT_CONFIG.authSetupPerIpLimit,
      windowMs: RATE_LIMIT_CONFIG.authSetupWindowMs,
    })
    if (!rl.allowed) {
      const retryAfterSeconds = Math.ceil(rl.retryAfterMs / 1000)
      return fail({
        status: 429,
        code: "RATE_LIMITED",
        meta: { retryAfterSeconds },
        headers: { "Retry-After": String(retryAfterSeconds) },
      })
    }
  }

  // Setup should only proceed after the DB schema is initialized (done on startup or via /api/setup/initialize-db).
  if (!isCurrentDatabaseSchemaReadySync()) return fail({ status: 503, code: "DB_NOT_READY" })

  const installed = await getInstallation()
    .then((i) => Boolean(i?.installedAt))
    .catch(() => false)
  if (installed) return fail({ status: 409, code: "ALREADY_INITIALIZED" })

  let body: z.infer<typeof setupSchema>
  try {
    body = setupSchema.parse(await req.json())
  } catch (e) {
    if (e instanceof z.ZodError) return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    throw e
  }

  const passwordHash = hashPassword(body.password)

  const created = await prisma
    .$transaction(async (tx) => {
      // Double-check inside the transaction (race-safe for first-run).
      const inst = await tx.installation.findUnique({ where: { id: "installation" }, select: { installedAt: true } })
      if (inst?.installedAt) throw new Error("ALREADY_INITIALIZED")
      const userCount = await tx.user.count()
      if (userCount > 0) throw new Error("ALREADY_INITIALIZED")

      await ensureInstallationRowTx(tx, { installedAt: new Date(), registrationMode: "DISABLED" })

      const pub = await allocatePublicId(tx, "user")
      const user = await tx.user.create({
        data: {
          id: crypto.randomUUID(),
          publicId: pub.publicId,
          publicNumber: pub.publicNumber,
          email: body.email.toLowerCase(),
          emailVerifiedAt: new Date(),
          name: body.name?.trim() ? body.name.trim() : null,
          role: "ADMIN",
          isDisabled: false,
          passwordHash,
          totpEnabled: false,
          totpSecret: null,
          totpVerifiedAt: null,
        },
        select: { id: true, publicId: true, email: true, role: true, totpEnabled: true },
      })

      // Backfill ownership/audit fields for pre-auth legacy data.
      // (If this is a fresh install, these tables are empty and these are no-ops.)
      await Promise.all([
        tx.workflow.updateMany({
          where: { ownerUserId: null },
          data: {
            ownerUserId: user.id,
            createdByUserId: user.id,
            updatedByUserId: user.id,
            triggeredByUserId: user.id,
          },
        }),
        tx.workflow.updateMany({
          where: { createdByUserId: null },
          data: { createdByUserId: user.id },
        }),
        tx.workflow.updateMany({
          where: { updatedByUserId: null },
          data: { updatedByUserId: user.id },
        }),
        tx.workflowVersion.updateMany({
          where: { ownerUserId: null },
          data: {
            ownerUserId: user.id,
            createdByUserId: user.id,
            updatedByUserId: user.id,
            triggeredByUserId: user.id,
          },
        }),
        tx.workflowVersion.updateMany({
          where: { createdByUserId: null },
          data: { createdByUserId: user.id },
        }),
        tx.run.updateMany({
          where: { ownerUserId: null },
          data: {
            ownerUserId: user.id,
            createdByUserId: user.id,
            updatedByUserId: user.id,
            triggeredByUserId: user.id,
          },
        }),
        tx.run.updateMany({
          where: { triggeredByUserId: null },
          data: { triggeredByUserId: user.id },
        }),
        tx.jobRun.updateMany({
          where: { ownerUserId: null },
          data: {
            ownerUserId: user.id,
            createdByUserId: user.id,
            updatedByUserId: user.id,
            triggeredByUserId: user.id,
            requestedByUserId: user.id,
          },
        }),
        tx.jobRun.updateMany({ where: { requestedByUserId: null }, data: { requestedByUserId: user.id } }),
        tx.batch.updateMany({
          where: { ownerUserId: null },
          data: {
            ownerUserId: user.id,
            createdByUserId: user.id,
            updatedByUserId: user.id,
            triggeredByUserId: user.id,
          },
        }),
        tx.schedule.updateMany({
          where: { ownerUserId: null },
          data: {
            ownerUserId: user.id,
            createdByUserId: user.id,
            updatedByUserId: user.id,
            triggeredByUserId: user.id,
          },
        }),
      ]).catch(() => {})
      return user
    })
    .catch((e) => {
      if ((e as Error)?.message === "ALREADY_INITIALIZED") return null
      throw e
    })
  if (!created) return fail({ status: 409, code: "ALREADY_INITIALIZED" })

  const ip = clientIp === "unknown" ? null : clientIp
  const ua = req.headers.get("user-agent") ?? null
  const sess = await createSession({ userId: created.id, ip, userAgent: ua })

  return ok(
    {
      ok: true,
      user: {
        id: created.publicId,
        publicId: created.publicId,
        email: created.email,
        role: created.role,
        totpEnabled: created.totpEnabled,
      },
    },
    {
      status: 201,
      headers: {
        "Set-Cookie": cookieHeaderForSession(sess.token, {
          expiresAt: sess.expiresAt,
          secure: getSessionCookieSecure(req),
        }),
      },
    },
  )
})
