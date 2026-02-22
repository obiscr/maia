"use client"

import * as React from "react"
import {
  type UIMessage,
  isReasoningUIPart,
  isFileUIPart,
  isToolUIPart,
  getToolName,
  type SourceUrlUIPart,
  type SourceDocumentUIPart,
} from "ai"

import { ChatMarkdown } from "@/components/common/markdown/chat-markdown"
import { ChatStreamdown } from "@/components/common/markdown/chat-streamdown"
import { MessageFilePart } from "@/components/workflows/agent/message-file-part"
import { MessageSourceDocument } from "@/components/workflows/agent/message-source-document"
import { MessageSourceUrl } from "@/components/workflows/agent/message-source-url"
import { ReasoningSummary } from "@/components/workflows/agent/reasoning-summary"
import { WorkflowAgentInlineToolCall } from "@/components/workflows/agent/workflow-agent-inline-tool-call"
import { WorkflowAgentProgressCompact } from "@/components/workflows/agent/workflow-agent-progress-compact"

type MessagePartsProps = {
  message: UIMessage
  isStreaming: boolean
  isLast: boolean
  t: (k: string) => string
  onToolApprovalResponse?: (input: { id: string; approved: boolean; reason?: string }) => void
  orchestratorProgress?: {
    plan?: { title?: string | null; steps?: Array<{ name: string; description: string }> } | null
    draftStepsCount: number
    done: boolean
  } | null
}

function MessagePartsImpl(props: MessagePartsProps) {
  const { message, isStreaming, isLast, t, onToolApprovalResponse } = props
  const elements: React.ReactNode[] = []
  const orchestratorProgress = props.orchestratorProgress
  let insertedOrchestratorProgress = false
  let draftStepIdx = 0
  const planSteps = orchestratorProgress?.plan?.steps

  const normalizeReasoningText = React.useCallback((raw: string) => {
    // OpenRouter/OpenAI sometimes returns placeholder-only reasoning.
    const trimmed = raw.replace(/\[REDACTED\]\s*$/g, "").trim()
    if (!trimmed || trimmed === "[REDACTED]") return ""
    return trimmed
  }, [])

  for (let i = 0; i < message.parts.length; i++) {
    const part = message.parts[i]!
    const key = `${message.id}-${i}`

    // ── text ──
    if (part.type === "text") {
      const text = part.text
      if (!text.trim()) continue
      elements.push(
        <div key={key}>
          <div className="min-w-0 w-full text-sm">
            {isStreaming && isLast ? (
              <ChatStreamdown markdown={text || t("workflows.orchestrator.thinking")} className="maia-mdx" />
            ) : (
              <ChatMarkdown markdown={text} className="maia-mdx" />
            )}
          </div>
        </div>,
      )
      continue
    }

    // ── reasoning ──
    if (isReasoningUIPart(part)) {
      const text = normalizeReasoningText(part.text)
      if (!text) continue
      const fallbackKey = "workflows.orchestrator.reasoningSummary.title"
      const fallbackFromI18n = t(fallbackKey)
      const fallbackTitle = fallbackFromI18n === fallbackKey ? "Reasoning" : fallbackFromI18n
      const doneTitleKey = "workflows.orchestrator.reasoningSummary.titleDone"
      const doneTitleFromI18n = t(doneTitleKey)
      const doneTitle = doneTitleFromI18n === doneTitleKey ? "Thought for {seconds}s" : doneTitleFromI18n
      elements.push(
        <div key={key}>
          <ReasoningSummary
            text={text}
            fallbackTitle={fallbackTitle}
            doneTitle={doneTitle}
            streaming={isStreaming && isLast}
            defaultOpen={true}
          />
        </div>,
      )
      continue
    }

    // ── source-url ──
    if (part.type === "source-url") {
      const p = part as SourceUrlUIPart
      elements.push(<MessageSourceUrl key={key} sourceId={p.sourceId} url={p.url} title={p.title} />)
      continue
    }

    // ── source-document ──
    if (part.type === "source-document") {
      const p = part as SourceDocumentUIPart
      elements.push(
        <MessageSourceDocument
          key={key}
          sourceId={p.sourceId}
          mediaType={p.mediaType}
          title={p.title}
          filename={p.filename}
        />,
      )
      continue
    }

    // ── file (image / audio / video / generic download) ──
    if (isFileUIPart(part)) {
      elements.push(
        <MessageFilePart key={key} url={part.url} mediaType={part.mediaType} filename={part.filename} t={t} />,
      )
      continue
    }

    // ── step-start (multi-step boundary, no visible UI) ──
    if (part.type === "step-start") {
      continue
    }

    // ── tool invocations ──
    if (isToolUIPart(part)) {
      const toolName = getToolName(part)

      if (toolName === "set_plan") {
        const progress = orchestratorProgress
        if (progress && !insertedOrchestratorProgress) {
          insertedOrchestratorProgress = true
          elements.push(
            <WorkflowAgentProgressCompact
              key={`${key}-progress`}
              title={String(progress.plan?.title ?? "").trim() || t("workflows.orchestrator.progress.planLabel")}
              generatingPlanText={t("workflows.orchestrator.generatingPlan")}
              generatingStepText={t("workflows.orchestrator.progress.generatingStep")}
              completedCountText={t("workflows.orchestrator.progress.completedCount")}
              stepsCountText={t("workflows.orchestrator.progress.stepsCount")}
              completedStepsCountText={t("workflows.orchestrator.progress.completedStepsCount")}
              plan={progress.plan}
              draftStepsCount={progress.draftStepsCount}
              done={progress.done}
            />,
          )
        }
        continue
      }

      let plannedName: string | undefined
      if (toolName === "draft_step" && planSteps) {
        plannedName = planSteps[draftStepIdx]?.name
        draftStepIdx++
      }
      elements.push(
        <WorkflowAgentInlineToolCall
          key={key}
          part={part}
          plannedName={plannedName}
          isStreaming={isStreaming && isLast}
          onToolApprovalResponse={onToolApprovalResponse}
        />,
      )
      continue
    }

    // ── data-* and unknown types — skip silently in production ──
    if (process.env.NODE_ENV === "development") {
      console.warn(`[MessageParts] unhandled part type: ${(part as { type: string }).type}`)
    }
  }

  return <>{elements}</>
}

export const MessageParts = React.memo(
  MessagePartsImpl,
  (prev, next) =>
    prev.message === next.message &&
    prev.isStreaming === next.isStreaming &&
    prev.isLast === next.isLast &&
    prev.t === next.t &&
    prev.orchestratorProgress === next.orchestratorProgress,
)
