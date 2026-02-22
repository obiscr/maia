import { notFound } from "next/navigation"
import type { Metadata } from "next"

import WorkflowAgentClient from "@/components/workflows/agent/workflow-agent-client"
import { getT } from "@/lib/server/i18n/server"
import { requireAuthedUser } from "@/lib/server/auth/require"
import { loadChat } from "@/lib/server/chat/persistence"
import { getAgentSettingsStatusForUser } from "@/lib/server/maia/agent-settings"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("common.entities.agent"),
    description: t("workflows.orchestrator.subtitleNew"),
  }
}

export default async function ChatPage(props: {
  params: Promise<{ chatId: string }>
  searchParams: Promise<{ prompt?: string }>
}) {
  const user = await requireAuthedUser()
  const { chatId } = await props.params
  const sp = await props.searchParams
  const prompt = String(sp?.prompt ?? "").trim() || undefined

  const chat = await loadChat(chatId, { userId: user.id })
  if (!chat) notFound()

  const settings = await getAgentSettingsStatusForUser(user.id)
  return (
    <WorkflowAgentClient
      key={chat.id}
      chatId={chat.id}
      workflowId={chat.workflowId ?? undefined}
      initialModel={chat.model ?? undefined}
      initialMessages={chat.messages}
      initialPrompt={prompt}
      initialApiKeyConfigured={settings.apiKeyConfigured}
    />
  )
}
