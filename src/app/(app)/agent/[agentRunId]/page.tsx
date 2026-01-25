import WorkflowAgentClient from "@/components/workflows/agent/workflow-agent-client"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("common.entities.agent"),
    description: t("workflows.orchestrator.subtitleNew"),
  }
}

export default async function AgentRunPage(props: { params: Promise<{ agentRunId: string }> }) {
  const { agentRunId } = await props.params
  return <WorkflowAgentClient agentRunId={agentRunId} />
}
