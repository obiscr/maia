import WorkflowEditClient from "@/components/workflows/editor/workflow-edit-client"
import { requirePublicResource } from "@/lib/server/routing/require-public-resource"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"
import { prisma } from "@/lib/server/db"
import { requireAuthedUser } from "@/lib/server/auth/require"

export async function generateMetadata(props: { params: Promise<{ workflowId: string }> }): Promise<Metadata> {
  await requireAuthedUser()
  const { workflowId } = await props.params
  const { t } = await getT()
  const publicId = String(workflowId || "")
    .trim()
    .toLowerCase()
  const workflow = await prisma.workflow.findUnique({
    where: { publicId },
    select: { name: true, description: true },
  })

  if (!workflow) {
    return {
      title: t("workflows.title"),
      description: t("workflows.listDescription"),
    }
  }

  const title = workflow.name || t("workflows.newWorkflowName")
  const description = workflow.description || t("workflows.editWorkflowDescription")

  return {
    title,
    description,
  }
}

export default async function WorkflowEditPage(props: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await props.params
  const normalized = await requirePublicResource("workflow", workflowId)
  return <WorkflowEditClient workflowId={normalized} />
}

