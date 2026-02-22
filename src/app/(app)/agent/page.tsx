import { AgentLandingPage } from "@/components/agent/agent-landing-page"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"
import { redirect } from "next/navigation"
import crypto from "node:crypto"

import { requireAuthedUser } from "@/lib/server/auth/require"
import { requirePublicResource } from "@/lib/server/routing/require-public-resource"
import { ensureChat } from "@/lib/server/chat/persistence"
import { getAgentSettingsStatusForUser } from "@/lib/server/maia/agent-settings"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("common.entities.agent"),
    description: t("workflows.orchestrator.subtitleNew"),
  }
}

export default async function Page(props: { searchParams: Promise<{ workflowId?: string; prompt?: string }> }) {
  const sp = await props.searchParams
  const workflowIdRaw = String(sp?.workflowId ?? "").trim()
  const prompt = String(sp?.prompt ?? "").trim()

  // Deep-link: /agent?workflowId=wf-10  → pre-create a chat and redirect to /agent/ch-xxx?workflowId=wf-10
  if (workflowIdRaw) {
    const user = await requireAuthedUser()
    const normalizedWorkflowId = await requirePublicResource("workflow", workflowIdRaw)
    const chatId = crypto.randomUUID()
    const { publicId } = await ensureChat({ chatId, userId: user.id, workflowId: normalizedWorkflowId })

    const qs = new URLSearchParams()
    qs.set("workflowId", normalizedWorkflowId)
    if (prompt) qs.set("prompt", prompt)
    redirect(`/agent/${encodeURIComponent(publicId)}?${qs.toString()}`)
  }

  const user = await requireAuthedUser()
  const settings = await getAgentSettingsStatusForUser(user.id)
  return <AgentLandingPage initialApiKeyConfigured={settings.apiKeyConfigured} />
}
