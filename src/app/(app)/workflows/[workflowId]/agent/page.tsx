import { AgentRunType } from "@prisma/client"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import type { Metadata } from "next"

import { requirePublicResource } from "@/lib/server/routing/require-public-resource"
import { getLocaleFromCookies, getT } from "@/lib/server/i18n/server"
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
  const workflow = await prisma.workflow.findUnique({
    where: { publicId },
    select: { name: true },
  })

  if (!workflow) {
    return {
      title: t("workflows.orchestrator.titleEdit"),
      description: t("workflows.orchestrator.subtitleEdit"),
    }
  }

  const name = typeof workflow.name === "string" ? workflow.name.trim() : ""
  if (!name) {
    return {
      title: t("workflows.orchestrator.titleEdit"),
      description: t("workflows.orchestrator.subtitleEdit"),
    }
  }

  return {
    title: `${name} - ${t("workflows.orchestrator.titleEdit")}`,
    description: t("workflows.orchestrator.subtitleEdit"),
  }
}

async function createAgentRunFromPrompt(args: { workflowId: string; prompt: string; locale: string }) {
  const h = await headers()
  const host = h.get("host")
  const proto = h.get("x-forwarded-proto") ?? "http"
  if (!host) throw new Error("Missing Host header")

  const res = await fetch(`${proto}://${host}/api/agent-runs`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      cookie: h.get("cookie") ?? "",
    },
    body: JSON.stringify({
      type: AgentRunType.WORKFLOW_ORCHESTRATE,
      workflowId: args.workflowId,
      locale: args.locale,
      messages: [{ role: "user", content: args.prompt }],
    }),
  })

  const json = (await res.json().catch(() => ({}))) as { agentRunId?: unknown }
  if (!res.ok) throw new Error(`Failed to create agent run (${res.status})`)

  const id = typeof json?.agentRunId === "string" ? String(json.agentRunId) : ""
  if (!id) throw new Error("Agent run created but no agentRunId returned")
  return id
}

export default async function WorkflowAgentEditPage(props: {
  params: Promise<{ workflowId: string }>
  searchParams: Promise<{ prompt?: string }>
}) {
  const { workflowId } = await props.params
  const normalized = await requirePublicResource("workflow", workflowId)

  const sp = await props.searchParams
  const prompt = String(sp?.prompt ?? "").trim()
  if (!prompt) redirect("/agent")

  const locale = await getLocaleFromCookies()
  const agentRunId = await createAgentRunFromPrompt({ workflowId: normalized, prompt, locale })
  redirect(`/agent/${encodeURIComponent(agentRunId)}`)
}
