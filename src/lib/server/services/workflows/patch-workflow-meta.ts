import "server-only"

import { z } from "zod"

import { prisma } from "@/lib/server/db"
import { makeUpdateAudit } from "@/lib/server/audit/write"
import type { RequestAuthContext } from "@/lib/server/authz"
import { getWorkflowFindFirstWhereByPublicId } from "@/lib/server/scopes/workflows-scope"
import type { ViewerAuthContext } from "@/lib/server/scopes/viewer-scope"

export const patchWorkflowMetaSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    description: z.string().optional().nullable(),
  })
  .refine(
    (v) => Object.prototype.hasOwnProperty.call(v, "name") || Object.prototype.hasOwnProperty.call(v, "description"),
    { message: "INVALID_BODY" },
  )

export async function patchWorkflowMetaByPublicId(params: {
  auth: RequestAuthContext
  viewerAuth: ViewerAuthContext
  workflowId: string
  body: z.infer<typeof patchWorkflowMetaSchema>
}) {
  const workflowPublicId = String(params.workflowId || "")
    .trim()
    .toLowerCase()
  const current = await prisma.workflow.findFirst({
    where: getWorkflowFindFirstWhereByPublicId(params.viewerAuth, workflowPublicId),
  })
  if (!current) return { ok: false as const, code: "WORKFLOW_NOT_FOUND" as const }

  const data: { name?: string; description?: string | null } = {}
  if (Object.prototype.hasOwnProperty.call(params.body, "name")) data.name = (params.body.name ?? "").trim()
  if (Object.prototype.hasOwnProperty.call(params.body, "description")) {
    const d = params.body.description
    data.description = typeof d === "string" && d.trim().length ? d.trim() : null
  }

  const updated = await prisma.workflow.update({
    where: { id: current.id },
    data: { ...data, ...makeUpdateAudit(params.auth) },
  })
  return { ok: true as const, workflow: { ...updated, id: updated.publicId } }
}
