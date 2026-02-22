import { z } from "zod"

import { fail, notFound, ok } from "@/lib/server/http/response"
import { zodIssues } from "@/lib/shared/http/zod"
import { mark, withApiObservability } from "@/lib/server/observability"
import { requireRequestAuth } from "@/lib/server/authz"
import { toViewerAuthContext } from "@/lib/server/scopes/viewer-scope"
import { deleteWorkflowByPublicId } from "@/lib/server/services/workflows/delete-workflow"
import { getWorkflowByPublicId } from "@/lib/server/services/workflows/get-workflow"
import {
  patchWorkflowMetaByPublicId,
  patchWorkflowMetaSchema,
} from "@/lib/server/services/workflows/patch-workflow-meta"
import { updateWorkflowByPublicId, updateWorkflowSchema } from "@/lib/server/services/workflows/update-workflow"

export const runtime = "nodejs"

const patchMetaSchema = patchWorkflowMetaSchema

export const GET = withApiObservability(async (_: Request, ctx: { params: Promise<{ workflowId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { workflowId } = await ctx.params
  const workflow = await getWorkflowByPublicId({ viewerAuth, workflowId })
  if (!workflow) return notFound("WORKFLOW_NOT_FOUND")
  return ok({ workflow })
})

export const PUT = withApiObservability(async (req: Request, ctx: { params: Promise<{ workflowId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { workflowId } = await ctx.params
  const workflowPublicId = String(workflowId || "")
    .trim()
    .toLowerCase()
  let body: z.infer<typeof updateWorkflowSchema>
  try {
    body = updateWorkflowSchema.parse(await req.json())
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    }
    throw e
  }

  const result = await updateWorkflowByPublicId({ auth, viewerAuth, workflowId: workflowPublicId, body })
  if (!result.ok) {
    if (result.code === "WORKFLOW_NOT_FOUND") return notFound("WORKFLOW_NOT_FOUND")
    return fail({ status: 400, code: result.code, meta: result.meta })
  }
  mark("db.tx")
  return ok({ workflow: result.workflow })
})

export const PATCH = withApiObservability(async (req: Request, ctx: { params: Promise<{ workflowId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { workflowId } = await ctx.params
  const workflowPublicId = String(workflowId || "")
    .trim()
    .toLowerCase()

  let body: z.infer<typeof patchMetaSchema>
  try {
    body = patchMetaSchema.parse(await req.json())
  } catch (e) {
    if (e instanceof z.ZodError) {
      return fail({ status: 422, code: "INVALID_BODY", issues: zodIssues(e) })
    }
    throw e
  }

  const result = await patchWorkflowMetaByPublicId({ auth, viewerAuth, workflowId: workflowPublicId, body })
  if (!result.ok) return notFound("WORKFLOW_NOT_FOUND")
  return ok({ workflow: result.workflow })
})

export const DELETE = withApiObservability(async (_: Request, ctx: { params: Promise<{ workflowId: string }> }) => {
  const auth = requireRequestAuth()
  const viewerAuth = toViewerAuthContext(auth)
  const { workflowId } = await ctx.params
  const result = await deleteWorkflowByPublicId({ viewerAuth, workflowId })
  if (!result.ok) return notFound("WORKFLOW_NOT_FOUND")
  mark("db.tx")
  return ok({ ok: true })
})
