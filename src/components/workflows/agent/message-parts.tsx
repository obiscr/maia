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

import { Bot, CheckCircle2, CirclePause, Lightbulb, ListTodo, MessageCircleDashed } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ChatMarkdown } from "@/components/common/markdown/chat-markdown"
import { ChatStreamdown } from "@/components/common/markdown/chat-streamdown"
import { MessageFilePart } from "@/components/workflows/agent/message-file-part"
import { MessageSourceDocument } from "@/components/workflows/agent/message-source-document"
import { MessageSourceUrl } from "@/components/workflows/agent/message-source-url"
import { ReasoningSummary } from "@/components/workflows/agent/reasoning-summary"
import { WorkflowAgentInlineToolCall } from "@/components/workflows/agent/workflow-agent-inline-tool-call"
import { PlanProgressCard } from "@/components/workflows/agent/plan-progress-card"
import { ToolApprovalCard } from "@/components/workflows/agent/tool-approval-card"
import { sdkToCanonicalToolName } from "@/lib/shared/agent/tool-parts"
import { type AgentMode, AGENT_MODE_I18N_KEYS, isAgentMode } from "@/lib/shared/agent/modes"

type MessagePartsProps = {
  message: UIMessage
  isStreaming: boolean
  isLast: boolean
  t: (k: string) => string
  onToolApprovalResponse?: (input: { id: string; approved: boolean; reason?: string }) => void
  onToolOutput?: (input: { tool: string; toolCallId: string; output: unknown }) => void
  onModeSwitch?: (mode: AgentMode) => void
  onModeStay?: () => void
  onPlanBuild?: (plan: {
    title: string
    summary: string
    steps: string[]
    highlights: string[]
    toolCallId: string
  }) => void
  orchestratorProgress?: {
    plan?: { title?: string | null; steps?: Array<{ stepKey?: string; name: string; description: string }> } | null
    draftStepsCount: number
    done: boolean
  } | null
  /** When true, a plan_ready card has triggered Build; suppress create_plan progress rendering. */
  planBuildActive?: boolean
}

function MessagePartsImpl(props: MessagePartsProps) {
  const {
    message,
    isStreaming,
    isLast,
    t,
    onToolApprovalResponse,
    onToolOutput,
    onModeSwitch,
    onModeStay,
    onPlanBuild,
  } = props
  const elements: React.ReactNode[] = []
  const orchestratorProgress = props.orchestratorProgress
  let insertedOrchestratorProgress = false
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

      if (toolName === "create_plan") {
        if (props.planBuildActive) continue
        if (!insertedOrchestratorProgress) {
          insertedOrchestratorProgress = true
          const inp = part.input as Record<string, unknown> | undefined
          const planTitle = String(inp?.title ?? orchestratorProgress?.plan?.title ?? "").trim()
          const planSummary = typeof inp?.summary === "string" ? inp.summary : ""
          const rawSteps = Array.isArray(inp?.steps) ? inp.steps : []
          const staticSteps: string[] = rawSteps.map((s: unknown) => {
            if (typeof s === "string") return s
            if (s && typeof s === "object") {
              const st = s as Record<string, unknown>
              return typeof st.name === "string" ? st.name : typeof st.stepKey === "string" ? st.stepKey : String(s)
            }
            return String(s)
          })
          elements.push(
            <PlanProgressCard
              key={`${key}-progress`}
              title={planTitle || t("workflows.orchestrator.progress.planLabel")}
              summary={planSummary}
              steps={staticSteps}
              t={t}
              orchestratorProgress={orchestratorProgress ?? undefined}
            />,
          )
        }
        continue
      }

      if (toolName === "suggest_mode_switch") {
        const input = part.input as Record<string, unknown> | undefined
        const toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : ""
        const targetMode =
          typeof input?.target_mode === "string" && isAgentMode(input.target_mode) ? input.target_mode : null
        const reason = typeof input?.reason === "string" ? input.reason : ""
        const output = part.output as Record<string, unknown> | undefined
        const accepted =
          part.state === "output-available" && output && typeof output.accepted === "boolean" ? output.accepted : null
        const initialChoice = accepted === true ? "switched" : accepted === false ? "stayed" : "pending"
        if (targetMode && toolCallId) {
          elements.push(
            <ModeSwitchCard
              key={key}
              targetMode={targetMode}
              reason={reason}
              toolCallId={toolCallId}
              initialChoice={initialChoice}
              t={t}
              onSwitch={onModeSwitch}
              onStay={onModeStay}
              onToolOutput={onToolOutput}
            />,
          )
        }
        continue
      }

      if (toolName === "plan_ready") {
        const isPartial = part.state === "input-streaming"
        const input = part.input as Record<string, unknown> | undefined
        const title = typeof input?.title === "string" ? input.title : ""
        const summary = typeof input?.summary === "string" ? input.summary : ""
        const rawSteps = Array.isArray(input?.steps) ? input.steps : []
        const toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : ""
        const steps: string[] = rawSteps.map((s: unknown) => {
          if (typeof s === "string") return s
          if (s && typeof s === "object") {
            const st = s as Record<string, unknown>
            return typeof st.name === "string" ? st.name : typeof st.stepKey === "string" ? st.stepKey : String(s)
          }
          return String(s)
        })
        const highlights = Array.isArray(input?.highlights) ? (input.highlights as string[]).map(String) : []
        if (title || isPartial) {
          elements.push(
            <PlanProgressCard
              key={key}
              title={title}
              summary={summary}
              steps={steps}
              highlights={highlights}
              t={t}
              streaming={isPartial || (isStreaming && isLast)}
              onBuild={() => {
                if (!toolCallId) return
                onPlanBuild?.({ title, summary, steps, highlights, toolCallId })
              }}
              onContinuePlanning={() => {
                if (!toolCallId) return
                onToolOutput?.({
                  tool: "plan_ready",
                  toolCallId,
                  output: { accepted: false },
                })
              }}
              onModeSwitch={onModeSwitch}
              planBuildActive={props.planBuildActive}
              orchestratorProgress={props.planBuildActive ? orchestratorProgress : null}
            />,
          )
        }
        continue
      }

      let plannedName: string | undefined
      if (toolName === "define_step" && planSteps) {
        const inp = part.input as Record<string, unknown> | undefined
        const step = inp?.step as Record<string, unknown> | undefined
        const stepKey = typeof step?.stepKey === "string" ? step.stepKey : null
        if (stepKey) {
          plannedName = planSteps.find((s) => s.stepKey === stepKey)?.name
        }
      }
      elements.push(
        <WorkflowAgentInlineToolCall
          key={key}
          part={part}
          plannedName={plannedName}
          isStreaming={isStreaming && isLast}
        />,
      )

      if (part.state === "approval-requested") {
        const approval = (part as unknown as { approval?: { id?: string } }).approval
        const approvalId = typeof approval?.id === "string" && approval.id.trim() ? approval.id : null
        if (approvalId) {
          const canonical = sdkToCanonicalToolName(toolName)
          const parts = canonical.split(".")
          const i18nLabel =
            (parts.length >= 2
              ? (() => {
                  const [domain, ...rest] = parts
                  const labelKey = `toolCalls.${domain}.${rest.join("_")}.label`
                  const v = t(labelKey)
                  return v !== labelKey ? v : null
                })()
              : null) ??
            (() => {
              const labelKey = `toolCalls.${toolName}.label`
              const v = t(labelKey)
              return v !== labelKey ? v : canonical
            })()
          elements.push(
            <ToolApprovalCard
              key={`${key}-approval`}
              approvalId={approvalId}
              toolLabel={i18nLabel}
              t={t}
              onResponse={onToolApprovalResponse}
            />,
          )
        }
      }
      continue
    }

    // ── data-* metadata parts are consumed elsewhere, not rendered ──
    if ((part as { type: string }).type.startsWith("data-")) continue

    if (process.env.NODE_ENV === "development") {
      console.warn(`[MessageParts] unhandled part type: ${(part as { type: string }).type}`)
    }
  }

  return <>{elements}</>
}

const MODE_SWITCH_ICONS: Record<AgentMode, React.ElementType> = {
  agent: Bot,
  chat: MessageCircleDashed,
  plan: ListTodo,
}

const MODE_SWITCH_RESULT_ICONS: Record<"switched" | "stayed", React.ElementType> = {
  switched: CheckCircle2,
  stayed: CirclePause,
}

function ModeSwitchCard(props: {
  targetMode: AgentMode
  reason: string
  toolCallId: string
  initialChoice?: "pending" | "switched" | "stayed"
  t: (k: string) => string
  onSwitch?: (mode: AgentMode) => void
  onStay?: () => void
  onToolOutput?: (input: { tool: string; toolCallId: string; output: unknown }) => void
}) {
  const { targetMode, reason, toolCallId, initialChoice = "pending", t, onSwitch, onStay, onToolOutput } = props
  const [choice, setChoice] = React.useState<"pending" | "switched" | "stayed">(initialChoice)

  React.useEffect(() => {
    setChoice(initialChoice)
  }, [initialChoice])

  const modeLabelKey = AGENT_MODE_I18N_KEYS[targetMode]
  const modeLabel = t(modeLabelKey)
  const ModeIcon = MODE_SWITCH_ICONS[targetMode]
  const ResultIcon = choice !== "pending" ? MODE_SWITCH_RESULT_ICONS[choice] : null

  return (
    <div className="my-2 rounded-lg border bg-muted/40 p-3">
      <div className="flex items-start gap-2">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-medium">{t("agent.mode.switchSuggestion").replace("{mode}", modeLabel)}</p>
          {reason ? <p className="text-xs text-muted-foreground">{reason}</p> : null}
          {choice !== "pending" ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {ResultIcon ? <ResultIcon className="h-3.5 w-3.5 shrink-0" /> : null}
              {t(choice === "switched" ? "agent.mode.switched" : "agent.mode.stayed")}
            </p>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="default"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => {
                  setChoice("switched")
                  onToolOutput?.({
                    tool: "suggest_mode_switch",
                    toolCallId,
                    output: { accepted: true, target_mode: targetMode },
                  })
                  onSwitch?.(targetMode)
                }}
              >
                <ModeIcon className="h-3 w-3" />
                {t("agent.mode.switchAction").replace("{mode}", modeLabel)}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setChoice("stayed")
                  onToolOutput?.({
                    tool: "suggest_mode_switch",
                    toolCallId,
                    output: { accepted: false },
                  })
                  onStay?.()
                }}
              >
                {t("agent.mode.stayAction")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export const MessageParts = React.memo(
  MessagePartsImpl,
  (prev, next) =>
    prev.message === next.message &&
    prev.isStreaming === next.isStreaming &&
    prev.isLast === next.isLast &&
    prev.t === next.t &&
    prev.onToolOutput === next.onToolOutput &&
    prev.onModeSwitch === next.onModeSwitch &&
    prev.onModeStay === next.onModeStay &&
    prev.onPlanBuild === next.onPlanBuild &&
    prev.orchestratorProgress === next.orchestratorProgress &&
    prev.planBuildActive === next.planBuildActive,
)
