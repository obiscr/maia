import WorkflowVersionDetailClient from "@/components/workflows/versions/workflow-version-detail-client"
import { requireWorkflowVersion } from "@/lib/server/routing/require-public-resource"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"
import { prisma } from "@/lib/server/db"
import { requireAuthedUser } from "@/lib/server/auth/require"

export async function generateMetadata(props: {
  params: Promise<{ workflowId: string; version: string }>
}): Promise<Metadata> {
  await requireAuthedUser()
  const { workflowId, version } = await props.params
  const { t } = await getT()
  try {
    const resolved = await requireWorkflowVersion({ rawWorkflowId: workflowId, rawVersion: version })
    const workflow = await prisma.workflow.findUnique({
      where: { publicId: resolved.workflowPublicId },
      select: { name: true },
    })

    if (!workflow) {
      return {
        title: t("workflows.versions.detailTitle", { version: resolved.version }),
        description: t("workflows.versions.description"),
      }
    }

    return {
      title: `${workflow.name} - ${t("workflows.versions.detailTitle", { version: resolved.version })}`,
      description: t("workflows.versions.descriptionNamed", { name: workflow.name }),
    }
  } catch {
    return {
      title: t("workflows.versions.title"),
      description: t("workflows.versions.description"),
    }
  }
}

export default async function WorkflowVersionDetailPage(props: {
  params: Promise<{ workflowId: string; version: string }>
}) {
  const { workflowId, version } = await props.params
  const resolved = await requireWorkflowVersion({ rawWorkflowId: workflowId, rawVersion: version })
  return <WorkflowVersionDetailClient workflowId={resolved.workflowPublicId} version={String(resolved.version)} />
}
