import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { requirePublicResource } from "@/lib/server/routing/require-public-resource"
import { getT } from "@/lib/server/i18n/server"
import { prisma } from "@/lib/server/db"
import { requireAuthedUser } from "@/lib/server/auth/require"

export const runtime = "nodejs"

export async function generateMetadata(props: { params: Promise<{ workflowId: string }> }): Promise<Metadata> {
  await requireAuthedUser()
  const { workflowId } = await props.params
  const { t } = await getT()
  const publicId = String(workflowId || "")
    .trim()
    .toLowerCase()
  const workflow = await prisma.workflow.findUnique({ where: { publicId }, select: { name: true } })
  const name = typeof workflow?.name === "string" ? workflow.name.trim() : ""

  return {
    title: name ? `${name} - ${t("workflows.orchestrator.titleEdit")}` : t("workflows.orchestrator.titleEdit"),
    description: t("workflows.orchestrator.subtitleEdit"),
  }
}

export default async function WorkflowAgentEditPage(props: {
  params: Promise<{ workflowId: string }>
  searchParams: Promise<{ prompt?: string }>
}) {
  const { workflowId } = await props.params
  const normalized = await requirePublicResource("workflow", workflowId)

  const sp = await props.searchParams
  const prompt = String(sp?.prompt ?? "").trim() || undefined

  const qs = new URLSearchParams()
  qs.set("workflowId", normalized)
  if (prompt) qs.set("prompt", prompt)
  redirect(`/agent?${qs.toString()}`)
}
