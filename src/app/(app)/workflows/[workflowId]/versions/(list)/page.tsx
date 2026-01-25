import WorkflowVersionsClient from "@/components/workflows/versions/workflow-versions-client"
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
    select: { name: true },
  })

  if (!workflow) {
    return {
      title: t("workflows.versions.title"),
      description: t("workflows.versions.description"),
    }
  }

  const name = typeof workflow.name === "string" ? workflow.name.trim() : ""
  if (!name) {
    return {
      title: t("workflows.versions.title"),
      description: t("workflows.versions.description"),
    }
  }

  return {
    title: `${name} - ${t("workflows.versions.title")}`,
    description: t("workflows.versions.descriptionNamed", { name }),
  }
}

export default async function WorkflowVersionsPage(props: { params: Promise<{ workflowId: string }> }) {
  const { workflowId } = await props.params
  const normalized = await requirePublicResource("workflow", workflowId)
  return <WorkflowVersionsClient workflowId={normalized} />
}
