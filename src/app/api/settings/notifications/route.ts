import { z } from "zod"

import { getAuthedUserFromRequest } from "@/lib/server/auth/session"
import { fail, ok } from "@/lib/server/http/response"
import { mark, withApiObservability } from "@/lib/server/observability"
import { prisma } from "@/lib/server/db"
import { zodIssues } from "@/lib/shared/http/zod"
import {
  getEmailNotificationMaskOverrideForUser,
  saveEmailNotificationMaskOverrideForUser,
} from "@/lib/server/email/user-email-notification-settings"
import { getSystemPublicBaseUrl } from "@/lib/server/settings/system-settings"
import { EMAIL_SETTINGS_ROW_ID } from "@/lib/server/installation"
import { isValidEmailNotificationMask, normalizeEmailNotificationMask } from "@/lib/shared/email/notification-mask"

export const runtime = "nodejs"

const updateSchema = z.object({
  // null => clear override (fall back to system default); number => set override; undefined => unchanged
  emailNotificationMask: z
    .union([z.number().int(), z.null()])
    .refine((v) => v === null || isValidEmailNotificationMask(v), "emailNotificationMask contains unknown bits")
    .optional(),
})

function requiresPublicBaseUrl(mask: number): boolean {
  return normalizeEmailNotificationMask(mask) !== 0
}

export const GET = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })

  const [overrideMask, systemSettings] = await Promise.all([
    getEmailNotificationMaskOverrideForUser(user.id),
    prisma.emailSettings
      .findUnique({ where: { id: EMAIL_SETTINGS_ROW_ID }, select: { emailNotificationMask: true } })
      .catch(() => null),
  ])
  const systemEmailNotificationMask =
    typeof systemSettings?.emailNotificationMask === "number"
      ? normalizeEmailNotificationMask(systemSettings.emailNotificationMask)
      : 0
  const effectiveEmailNotificationMask =
    typeof overrideMask === "number" ? normalizeEmailNotificationMask(overrideMask) : systemEmailNotificationMask
  mark("read")
  return ok({
    settings: {
      emailNotificationMask: overrideMask,
      systemEmailNotificationMask,
      effectiveEmailNotificationMask,
    },
  })
})

export const PUT = withApiObservability(async (req: Request) => {
  const user = await getAuthedUserFromRequest(req).catch(() => null)
  if (!user) return fail({ status: 401, code: "UNAUTHORIZED" })

  let body: z.infer<typeof updateSchema>
  try {
    body = updateSchema.parse(await req.json().catch(() => ({})))
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    }
    throw e
  }

  if (body.emailNotificationMask === undefined) {
    const [overrideMask, systemSettings] = await Promise.all([
      getEmailNotificationMaskOverrideForUser(user.id),
      prisma.emailSettings
        .findUnique({ where: { id: EMAIL_SETTINGS_ROW_ID }, select: { emailNotificationMask: true } })
        .catch(() => null),
    ])
    const systemEmailNotificationMask =
      typeof systemSettings?.emailNotificationMask === "number"
        ? normalizeEmailNotificationMask(systemSettings.emailNotificationMask)
        : 0
    const effectiveEmailNotificationMask =
      typeof overrideMask === "number" ? normalizeEmailNotificationMask(overrideMask) : systemEmailNotificationMask
    mark("read")
    return ok({
      settings: {
        emailNotificationMask: overrideMask,
        systemEmailNotificationMask,
        effectiveEmailNotificationMask,
      },
    })
  }

  if (typeof body.emailNotificationMask === "number" && requiresPublicBaseUrl(body.emailNotificationMask)) {
    const publicBaseUrl = await getSystemPublicBaseUrl().catch(() => null)
    if (!publicBaseUrl) {
      return fail({ status: 409, code: "SYSTEM_PUBLIC_BASE_URL_REQUIRED" })
    }
  }

  const settings = await saveEmailNotificationMaskOverrideForUser({
    userId: user.id,
    mask: body.emailNotificationMask,
  })
  const systemSettings = await prisma.emailSettings
    .findUnique({ where: { id: EMAIL_SETTINGS_ROW_ID }, select: { emailNotificationMask: true } })
    .catch(() => null)
  const systemEmailNotificationMask =
    typeof systemSettings?.emailNotificationMask === "number"
      ? normalizeEmailNotificationMask(systemSettings.emailNotificationMask)
      : 0
  const effectiveEmailNotificationMask =
    typeof settings.mask === "number" ? normalizeEmailNotificationMask(settings.mask) : systemEmailNotificationMask
  mark("write")
  return ok({
    settings: {
      emailNotificationMask: settings.mask,
      systemEmailNotificationMask,
      effectiveEmailNotificationMask,
    },
  })
})
