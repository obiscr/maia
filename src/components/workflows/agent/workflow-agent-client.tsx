"use client"
/* @refresh reset */

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowUp, Bot, Pencil, Plus, Save, Trash2Icon } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { cn } from "@/lib/utils"
import { ChatMarkdown } from "@/components/common/markdown/chat-markdown"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Card } from "@/components/ui/card"
import { SectionCard } from "@/components/common/section-card"
import { WorkflowGraphCanvasWrapper } from "@/components/graph/workflow-graph-canvas-wrapper"
import { useWorkflowAgentSession } from "@/components/workflows/agent/use-workflow-agent-session"
import { WorkflowAgentProgressCompact } from "@/components/workflows/agent/workflow-agent-progress-compact"
import { setupMaiaMonaco, maiaMonacoOptions } from "@/lib/client/monaco"
import { MAIA_JAVASCRIPT_LANGUAGE_ID } from "@/lib/client/monaco-maia-javascript"
import { StandardActionDialog } from "@/components/common/standard-action-dialog"
import { WorkflowQuickExamples } from "@/components/workflows/common/workflow-quick-examples"
import { WorkflowAgentStageCard } from "@/components/workflows/agent/workflow-agent-stage-card"
import { MaiaMonacoEditor } from "@/components/common/maia-monaco-editor"
import { StandardPageHeader } from "@/components/common/standard-page-header"
import { DetailPageLayout } from "@/components/common/detail-page-layout"
import { useIsMobile } from "@/hooks/use-mobile"
import { ErrorAlert } from "@/components/common/error-alert"
import { resolveAgentRunDisplayError } from "@/lib/shared/error-display/adapters/agent-run"

export default function WorkflowAgentClient(props: { agentRunId?: string | null; workflowId?: string }) {
  const { t, locale } = useI18n()
  const router = useRouter()
  const isMobile = useIsMobile()
  const workflowId = props.workflowId
  const session = useWorkflowAgentSession({ agentRunId: props.agentRunId ?? null, workflowId, locale, t })
  const selectedStep = session.selectedStep
  const stepKeyInputId = React.useId()
  const stepNameInputId = React.useId()
  const stepTimeoutInputId = React.useId()
  const [newChatConfirmOpen, setNewChatConfirmOpen] = React.useState(false)
  const [mobileTab, setMobileTab] = React.useState<"chat" | "canvas">("chat")

  const composerTextareaRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [composerExpanded, setComposerExpanded] = React.useState(false)

  // Product-y behavior:
  // - Default height is compact (2 grid rows).
  // - If content starts to exceed the compact size (newline/wrap overflow), expand to 3 rows.
  // - Collapse back only when cleared (avoids oscillation).
  React.useEffect(() => {
    const trimmed = session.input.trim()
    if (!trimmed) {
      if (composerExpanded) setComposerExpanded(false)
      return
    }
    if (!composerExpanded && session.input.includes("\n")) {
      setComposerExpanded(true)
    }
  }, [session.input, composerExpanded])

  const setComposerRef = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      composerTextareaRef.current = node
      ;(session.inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node
    },
    [session.inputRef],
  )

  const startNewChat = React.useCallback(() => {
    router.push("/agent")
  }, [router])

  const onNewChatClick = React.useCallback(() => {
    if (session.pending || session.saving) return
    if (session.isDirty) {
      setNewChatConfirmOpen(true)
      return
    }
    startNewChat()
  }, [session.pending, session.saving, session.isDirty, startNewChat])

  const stepSheetContentRef = React.useRef<HTMLDivElement | null>(null)
  const title = workflowId ? t("workflows.orchestrator.titleEdit") : t("workflows.orchestrator.titleNew")
  const subtitle = workflowId ? t("workflows.orchestrator.subtitleEdit") : t("workflows.orchestrator.subtitleNew")
  const chatSpan = composerExpanded ? "row-span-4 lg:row-span-7" : "row-span-5 lg:row-span-8"
  const composerSpan = composerExpanded ? "row-span-3" : "row-span-2"
  const agentRunErrorCode = session.agentRunError
    ? resolveAgentRunDisplayError({
        errorCode: session.agentRunError.errorCode,
        errorMessage: session.agentRunError.errorMessage,
        errorMetaJson: session.agentRunError.errorMetaJson,
      }).displayCode
    : null

  return (
    <DetailPageLayout
      variant="fill"
      modals={
        <>
          <StandardActionDialog
            open={newChatConfirmOpen}
            onOpenChange={setNewChatConfirmOpen}
            title={t("common.unsavedChanges")}
            description={t("workflows.orchestrator.newChatUnsavedDescription")}
            pending={session.saving || session.pending}
            actions={[
              {
                key: "cancel",
                kind: "cancel",
                label: t("common.keepEditingAction"),
                icon: <Pencil className="h-4 w-4" />,
                disabled: session.saving || session.pending,
              },
              {
                key: "discard",
                label: t("common.discardAction"),
                icon: <Trash2Icon className="h-4 w-4" />,
                variant: "destructive",
                disabled: session.saving || session.pending,
                onClick: () => {
                  setNewChatConfirmOpen(false)
                  router.push("/agent")
                },
              },
              {
                key: "save",
                label: session.saving ? t("common.saving") : t("common.saveAction"),
                icon: session.saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />,
                disabled: session.saving || session.pending,
                onClick: async () => {
                  const ok = await session.saveFromCurrentState({ redirect: false })
                  if (!ok) return
                  setNewChatConfirmOpen(false)
                  router.push("/agent")
                },
              },
            ]}
          />

          <Sheet open={session.stepSheetOpen} onOpenChange={session.setStepSheetOpen}>
            <SheetContent
              side="right"
              className="w-full sm:max-w-2xl flex flex-col"
              ref={stepSheetContentRef}
              onOpenAutoFocus={(e) => {
                e.preventDefault()
                requestAnimationFrame(() => {
                  const root = stepSheetContentRef.current
                  if (!root) return
                  const first =
                    (root.querySelector(
                      "input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
                    ) as HTMLElement | null) ?? null
                  first?.focus()
                })
              }}
            >
              <SheetHeader>
                <SheetTitle>
                  {selectedStep ? selectedStep.name : t("workflows.orchestrator.stepsRightTitle")}
                </SheetTitle>
                <SheetDescription className="sr-only">{t("workflows.orchestrator.stepSelectHint")}</SheetDescription>
              </SheetHeader>

              {!selectedStep ? (
                <div className="px-4 pt-4 text-sm text-muted-foreground">
                  {t("workflows.orchestrator.stepSelectHint")}
                </div>
              ) : (
                <div className="min-h-0 flex flex-1 flex-col gap-4 px-4 pb-4 pt-4">
                  {/* Step form (match WorkflowEditClient sheet) */}
                  <FieldGroup className="shrink-0 gap-3">
                    <Field className="gap-1">
                      <FieldLabel htmlFor={stepKeyInputId}>{t("workflows.stepKey")}</FieldLabel>
                      <Input
                        id={stepKeyInputId}
                        value={selectedStep.stepKey}
                        onChange={(e) => session.renameDraftStepKey(selectedStep.stepKey, e.target.value)}
                      />
                    </Field>

                    <Field className="gap-1">
                      <FieldLabel htmlFor={stepNameInputId}>{t("workflows.name")}</FieldLabel>
                      <Input
                        id={stepNameInputId}
                        value={selectedStep.name}
                        onChange={(e) => session.updateDraftStep(selectedStep.stepKey, { name: e.target.value })}
                      />
                    </Field>

                    <Field className="gap-1">
                      <FieldLabel htmlFor={stepTimeoutInputId}>{t("workflows.timeoutMs")}</FieldLabel>
                      <Input
                        id={stepTimeoutInputId}
                        type="number"
                        value={String(selectedStep.timeoutMs ?? "")}
                        onChange={(e) =>
                          session.updateDraftStep(selectedStep.stepKey, {
                            timeoutMs: Number(e.target.value) || selectedStep.timeoutMs,
                          })
                        }
                      />
                    </Field>
                  </FieldGroup>

                  {/* Script editor (fills remaining space) */}
                  <div className="min-h-0 flex flex-1 flex-col">
                    <SectionCard className="flex flex-col">
                      <div className="border-b bg-muted/10 px-3 py-2 text-sm font-medium">
                        {t("workflows.scriptEsm")}
                      </div>
                      <div className="min-h-0 flex-1">
                        <MaiaMonacoEditor
                          height="100%"
                          defaultLanguage={MAIA_JAVASCRIPT_LANGUAGE_ID}
                          theme={session.monacoTheme}
                          value={selectedStep.scriptEsm}
                          onChange={(v) => session.updateDraftStep(selectedStep.stepKey, { scriptEsm: v ?? "" })}
                          beforeMount={setupMaiaMonaco}
                          options={maiaMonacoOptions}
                        />
                      </div>
                      <div className="border-t bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
                        {t("workflows.engineRunsTipAgent")}
                      </div>
                    </SectionCard>
                  </div>
                </div>
              )}
            </SheetContent>
          </Sheet>
        </>
      }
      header={<StandardPageHeader title={title} description={subtitle} />}
      bodyClassName="min-h-0 flex-1 overflow-hidden"
    >
      <div className="min-h-0 flex-1 overflow-hidden">
        {isMobile ? (
          <Tabs
            value={mobileTab}
            onValueChange={(v) => setMobileTab(v as "chat" | "canvas")}
            className="flex h-full min-h-0 flex-col gap-3"
          >
            {/* Segmented control: Chat / Canvas */}
            <div className="shrink-0">
              <TabsList className="w-full">
                <TabsTrigger value="chat" className="flex-1">
                  {t("common.tabs.chat")}
                </TabsTrigger>
                <TabsTrigger value="canvas" className="flex-1">
                  {t("common.tabs.canvas")}
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="chat" className="min-h-0 flex-1">
              <div className="grid h-full min-h-0 grid-rows-7 gap-3">
                {/* Chat */}
                <Card className={cn("min-h-0 overflow-hidden p-0 shadow-none rounded-md", chatSpan)}>
                  <div className="flex h-full min-h-0 flex-col">
                    <ScrollArea className="relative h-full min-h-0 flex-1 bg-background p-3">
                      {session.messages.length === 0 ? (
                        <div className="absolute inset-0 grid place-items-center p-6">
                          <div className="w-full max-w-2xl">
                            {/* Match the Workflows empty-state visual language (figure 2): icon + title */}
                            <div className="mb-5 flex flex-col items-center justify-center gap-3 text-center">
                              <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-foreground">
                                <Bot className="h-5 w-5" aria-hidden="true" />
                              </div>
                              <div className="text-lg font-semibold">{t("workflows.emptyTitle")}</div>
                            </div>

                            <WorkflowQuickExamples
                              count={6}
                              layout="wrap"
                              behavior="fill"
                              className="justify-center"
                              onPick={(text) => {
                                session.setInput(text)
                                requestAnimationFrame(() => session.inputRef.current?.focus())
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {session.messages.map((m, idx) => (
                            <div key={idx} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                              <div
                                className={cn(
                                  // Robust wrapping for long unbroken strings (URLs/tokens/base64) to prevent horizontal layout overflow.
                                  "min-w-0 max-w-full overflow-x-hidden rounded-md px-3 py-2 text-sm",
                                  m.role === "user" ? "bg-primary text-primary-foreground" : "",
                                )}
                              >
                                {m.role === "assistant" ? (
                                  <ChatMarkdown
                                    markdown={
                                      session.pending && idx === session.messages.length - 1
                                        ? m.content || t("workflows.orchestrator.thinking")
                                        : m.content || ""
                                    }
                                    streaming={session.pending && idx === session.messages.length - 1}
                                    className="maia-mdx"
                                  />
                                ) : (
                                  <div className="whitespace-pre-wrap break-all">{m.content}</div>
                                )}
                              </div>
                            </div>
                          ))}

                          {session.hasAssistantOutput ? (
                            <div className="pt-1">
                              <div className="space-y-2">
                                {session.stages.plan !== "todo" ? (
                                  <WorkflowAgentStageCard
                                    label={
                                      session.stages.plan === "in_progress"
                                        ? t("workflows.orchestrator.generatingPlan")
                                        : t("workflows.orchestrator.progress.planLabel")
                                    }
                                    status={session.stages.plan}
                                    doneText={t("workflows.orchestrator.progress.doneBadge")}
                                  />
                                ) : null}

                                {/* Step list card (existing, keep as-is). */}
                                {session.plan && session.stages.plan === "done" ? (
                                  <WorkflowAgentProgressCompact
                                    title={String(
                                      (session.plan &&
                                        typeof session.plan === "object" &&
                                        "title" in session.plan &&
                                        typeof (session.plan as { title?: unknown }).title === "string" &&
                                        (session.plan as { title?: string }).title) ??
                                        t("common.entities.workflow"),
                                    )}
                                    generatingPlanText={t("workflows.orchestrator.generatingPlan")}
                                    generatingStepText={t("workflows.orchestrator.progress.generatingStep")}
                                    completedCountText={t("workflows.orchestrator.progress.completedCount")}
                                    plan={session.plan}
                                    draftStepsCount={session.progress.doneCount}
                                    done={session.progress.phase === "done"}
                                  />
                                ) : null}

                                {session.stages.validate !== "todo" ? (
                                  <WorkflowAgentStageCard
                                    label={
                                      session.stages.validate === "in_progress"
                                        ? t("workflows.orchestrator.progress.validating")
                                        : t("workflows.orchestrator.progress.validateLabel")
                                    }
                                    status={session.stages.validate}
                                    doneText={t("workflows.orchestrator.progress.doneBadge")}
                                    failedText={t("common.statusValues.failed")}
                                  />
                                ) : null}

                                {session.stages.inputSpec !== "todo" ? (
                                  <WorkflowAgentStageCard
                                    label={
                                      session.stages.inputSpec === "in_progress"
                                        ? t("workflows.orchestrator.progress.generatingInputSpec")
                                        : t("workflows.orchestrator.progress.inputSpecLabel")
                                    }
                                    status={session.stages.inputSpec}
                                    doneText={t("workflows.orchestrator.progress.doneBadge")}
                                    failedText={t("common.statusValues.failed")}
                                  />
                                ) : null}

                                {session.stages.outputsSpec !== "todo" ? (
                                  <WorkflowAgentStageCard
                                    label={
                                      session.stages.outputsSpec === "in_progress"
                                        ? t("workflows.orchestrator.progress.generatingOutputsSpec")
                                        : t("workflows.orchestrator.progress.outputsSpecLabel")
                                    }
                                    status={session.stages.outputsSpec}
                                    doneText={t("workflows.orchestrator.progress.doneBadge")}
                                    failedText={t("common.statusValues.failed")}
                                  />
                                ) : null}
                              </div>
                            </div>
                          ) : null}

                          {session.isDirty && session.stepsForGraph.length > 0 && !session.pending ? (
                            <div className="pt-2">
                              <div className="rounded-md border bg-muted/10 p-3">
                                <div className="text-sm font-medium">
                                  {session.proposal?.draft
                                    ? t("workflows.orchestrator.proposalReadyTitle")
                                    : t("workflows.orchestrator.draftReadyTitle")}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {session.proposal?.draft
                                    ? t("workflows.orchestrator.proposalReadyDescription")
                                    : t("workflows.orchestrator.draftReadyDescription")}
                                </div>
                                <div className="mt-2">
                                  <Button
                                    onClick={() => void session.saveFromCurrentState()}
                                    disabled={session.pending || session.saving}
                                    size="sm"
                                    className="w-full"
                                  >
                                    {session.saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                                    {session.saving
                                      ? t("common.saving")
                                      : workflowId
                                        ? t("common.saveAction")
                                        : t("workflows.orchestrator.applyCreateAction")}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ) : null}

                          <div ref={session.listRef} />
                        </div>
                      )}
                    </ScrollArea>
                    {agentRunErrorCode ? (
                      <div className="shrink-0 bg-background px-3 pb-3">
                        <ErrorAlert
                          code={agentRunErrorCode}
                          variant="destructive"
                          actions={[
                            {
                              key: "agentPreferences",
                              label: `${t("common.entities.agent")} ${t("common.settings")}`,
                              onClick: () => router.push("/preference/agent"),
                            },
                          ]}
                        />
                      </div>
                    ) : null}
                  </div>
                </Card>

                {/* Composer */}
                <Card className={cn("min-h-0 overflow-hidden p-0 shadow-none rounded-md", composerSpan)}>
                  <div className="flex h-full min-h-0 flex-col bg-background">
                    <InputGroup
                      className={cn(
                        "min-h-0 flex-1",
                        "has-[>textarea]:h-auto h-auto",
                        "!border-0 !shadow-none !bg-transparent dark:!bg-transparent",
                        "has-[[data-slot=input-group-control]:focus-visible]:!border-0 has-[[data-slot=input-group-control]:focus-visible]:!ring-0",
                      )}
                    >
                      <InputGroupTextarea
                        ref={setComposerRef}
                        value={session.input}
                        onChange={(e) => session.setInput(e.target.value)}
                        placeholder={t("workflows.orchestrator.composerPlaceholder")}
                        className={cn(
                          // Fill the card area and scroll internally (do NOT grow the page).
                          "min-h-0 flex-1 w-full px-3 text-base md:text-sm",
                          "py-3 resize-none rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent",
                          "overflow-y-auto",
                        )}
                        // Override the base Textarea `field-sizing-content` behavior so content never expands layout.
                        style={{ fieldSizing: "fixed" } as React.CSSProperties}
                        disabled={session.pending}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault()
                            void session.send()
                          }
                        }}
                      />

                      <InputGroupAddon align="block-end" className="order-last w-full justify-between px-3 pb-3">
                        <InputGroupButton
                          variant="outline"
                          size="icon-xs"
                          className="size-8 rounded-full p-0 dark:bg-input/30 dark:border-input dark:hover:bg-input/50"
                          aria-label={t("workflows.orchestrator.newChat")}
                          onClick={onNewChatClick}
                          disabled={session.pending || session.saving}
                        >
                          <Plus className="size-5" />
                        </InputGroupButton>

                        <InputGroupButton
                          variant="default"
                          size="icon-xs"
                          className="size-8 rounded-full p-0"
                          onClick={() => void session.send()}
                          disabled={session.pending || !session.input.trim()}
                          aria-label={t("workflows.orchestrator.sendAction")}
                        >
                          {session.pending ? <Spinner className="size-5" /> : <ArrowUp className="size-5" />}
                          <span className="sr-only">{t("workflows.orchestrator.sendAction")}</span>
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
                  </div>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="canvas" className="min-h-0 flex-1">
              <SectionCard className="h-full min-h-0 overflow-hidden bg-card text-card-foreground">
                <div className="relative h-full">
                  <WorkflowGraphCanvasWrapper
                    mode="view"
                    frame={false}
                    workflowId={workflowId}
                    forceAutoFit
                    // Agent new: no workflowId => no persisted layout, keep UI minimal (zoom + fit only).
                    // Agent edit: workflowId present => allow LR/TB/CUSTOM to view user's saved layout presets.
                    showLayoutMenu={!!workflowId}
                    allowCustomLayout={!!workflowId}
                    showLayoutReset={false}
                    controls={{
                      interaction: false,
                      layout: true,
                      fit: true,
                      zoom: true,
                    }}
                    steps={session.stepsForGraph.map((s) => ({ stepKey: s.stepKey, name: s.name, deps: s.deps }))}
                    onEditStep={(k) => {
                      session.setSelectedStepKey(k)
                      session.setStepSheetOpen(true)
                    }}
                    className="h-full"
                  />
                </div>
              </SectionCard>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="grid h-full min-h-0 grid-rows-10 gap-3 lg:grid-cols-12 xl:grid-cols-10 lg:grid-rows-1">
            {/* Canvas */}
            <SectionCard className="min-h-0 row-span-3 bg-card text-card-foreground lg:col-span-7 xl:col-span-7 lg:row-span-1">
              <div className="relative h-full">
                <WorkflowGraphCanvasWrapper
                  mode="view"
                  frame={false}
                  workflowId={workflowId}
                  forceAutoFit
                  // Agent new: no workflowId => no persisted layout, keep UI minimal (zoom + fit only).
                  // Agent edit: workflowId present => allow LR/TB/CUSTOM to view user's saved layout presets.
                  showLayoutMenu={!!workflowId}
                  allowCustomLayout={!!workflowId}
                  showLayoutReset={false}
                  controls={{
                    interaction: false,
                    layout: true,
                    fit: true,
                    zoom: true,
                  }}
                  steps={session.stepsForGraph.map((s) => ({ stepKey: s.stepKey, name: s.name, deps: s.deps }))}
                  onEditStep={(k) => {
                    session.setSelectedStepKey(k)
                    session.setStepSheetOpen(true)
                  }}
                  className="h-full"
                />
              </div>
            </SectionCard>

            {/* Right side: chat + composer */}
            <div className="min-h-0 row-span-7 grid grid-rows-7 gap-3 lg:col-span-5 xl:col-span-3 lg:row-span-1 lg:grid-rows-10">
              {/* Chat */}
              <Card className={cn("min-h-0 overflow-hidden p-0 shadow-none rounded-md", chatSpan)}>
                <div className="flex h-full min-h-0 flex-col">
                  <ScrollArea className="relative h-full min-h-0 flex-1 bg-background p-3">
                    {session.messages.length === 0 ? (
                      <div className="absolute inset-0 grid place-items-center p-6">
                        <div className="w-full max-w-2xl">
                          {/* Match the Workflows empty-state visual language (figure 2): icon + title */}
                          <div className="mb-5 flex flex-col items-center justify-center gap-3 text-center">
                            <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-foreground">
                              <Bot className="h-5 w-5" aria-hidden="true" />
                            </div>
                            <div className="text-lg font-semibold">{t("workflows.emptyTitle")}</div>
                          </div>

                          <WorkflowQuickExamples
                            count={6}
                            layout="wrap"
                            behavior="fill"
                            className="justify-center"
                            onPick={(text) => {
                              session.setInput(text)
                              requestAnimationFrame(() => session.inputRef.current?.focus())
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {session.messages.map((m, idx) => (
                          <div key={idx} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                            <div
                              className={cn(
                                // Robust wrapping for long unbroken strings (URLs/tokens/base64) to prevent horizontal layout overflow.
                                "min-w-0 max-w-full overflow-x-hidden rounded-md px-3 py-2 text-sm",
                                m.role === "user" ? "bg-primary text-primary-foreground" : "",
                              )}
                            >
                              {m.role === "assistant" ? (
                                <ChatMarkdown
                                  markdown={
                                    session.pending && idx === session.messages.length - 1
                                      ? m.content || t("workflows.orchestrator.thinking")
                                      : m.content || ""
                                  }
                                  streaming={session.pending && idx === session.messages.length - 1}
                                  className="maia-mdx"
                                />
                              ) : (
                                <div className="whitespace-pre-wrap break-all">{m.content}</div>
                              )}
                            </div>
                          </div>
                        ))}

                        {session.hasAssistantOutput ? (
                          <div className="pt-1">
                            <div className="space-y-2">
                              {session.stages.plan !== "todo" ? (
                                <WorkflowAgentStageCard
                                  label={
                                    session.stages.plan === "in_progress"
                                      ? t("workflows.orchestrator.generatingPlan")
                                      : t("workflows.orchestrator.progress.planLabel")
                                  }
                                  status={session.stages.plan}
                                  doneText={t("workflows.orchestrator.progress.doneBadge")}
                                />
                              ) : null}

                              {/* Step list card (existing, keep as-is). */}
                              {session.plan && session.stages.plan === "done" ? (
                                <WorkflowAgentProgressCompact
                                  title={String(
                                    (session.plan &&
                                      typeof session.plan === "object" &&
                                      "title" in session.plan &&
                                      typeof (session.plan as { title?: unknown }).title === "string" &&
                                      (session.plan as { title?: string }).title) ??
                                      t("common.entities.workflow"),
                                  )}
                                  generatingPlanText={t("workflows.orchestrator.generatingPlan")}
                                  generatingStepText={t("workflows.orchestrator.progress.generatingStep")}
                                  completedCountText={t("workflows.orchestrator.progress.completedCount")}
                                  plan={session.plan}
                                  draftStepsCount={session.progress.doneCount}
                                  done={session.progress.phase === "done"}
                                />
                              ) : null}

                              {session.stages.validate !== "todo" ? (
                                <WorkflowAgentStageCard
                                  label={
                                    session.stages.validate === "in_progress"
                                      ? t("workflows.orchestrator.progress.validating")
                                      : t("workflows.orchestrator.progress.validateLabel")
                                  }
                                  status={session.stages.validate}
                                  doneText={t("workflows.orchestrator.progress.doneBadge")}
                                  failedText={t("common.statusValues.failed")}
                                />
                              ) : null}

                              {session.stages.inputSpec !== "todo" ? (
                                <WorkflowAgentStageCard
                                  label={
                                    session.stages.inputSpec === "in_progress"
                                      ? t("workflows.orchestrator.progress.generatingInputSpec")
                                      : t("workflows.orchestrator.progress.inputSpecLabel")
                                  }
                                  status={session.stages.inputSpec}
                                  doneText={t("workflows.orchestrator.progress.doneBadge")}
                                  failedText={t("common.statusValues.failed")}
                                />
                              ) : null}

                              {session.stages.outputsSpec !== "todo" ? (
                                <WorkflowAgentStageCard
                                  label={
                                    session.stages.outputsSpec === "in_progress"
                                      ? t("workflows.orchestrator.progress.generatingOutputsSpec")
                                      : t("workflows.orchestrator.progress.outputsSpecLabel")
                                  }
                                  status={session.stages.outputsSpec}
                                  doneText={t("workflows.orchestrator.progress.doneBadge")}
                                  failedText={t("common.statusValues.failed")}
                                />
                              ) : null}
                            </div>
                          </div>
                        ) : null}

                        {session.isDirty && session.stepsForGraph.length > 0 && !session.pending ? (
                          <div className="pt-2">
                            <div className="rounded-md border bg-muted/10 p-3">
                              <div className="text-sm font-medium">
                                {session.proposal?.draft
                                  ? t("workflows.orchestrator.proposalReadyTitle")
                                  : t("workflows.orchestrator.draftReadyTitle")}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {session.proposal?.draft
                                  ? t("workflows.orchestrator.proposalReadyDescription")
                                  : t("workflows.orchestrator.draftReadyDescription")}
                              </div>
                              <div className="mt-2">
                                <Button
                                  onClick={() => void session.saveFromCurrentState()}
                                  disabled={session.pending || session.saving}
                                  size="sm"
                                  className="w-full"
                                >
                                  {session.saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                                  {session.saving
                                    ? t("common.saving")
                                    : workflowId
                                      ? t("common.saveAction")
                                      : t("workflows.orchestrator.applyCreateAction")}
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        <div ref={session.listRef} />
                      </div>
                    )}
                  </ScrollArea>
                  {agentRunErrorCode ? (
                    <div className="shrink-0 bg-background px-3 pb-3">
                      <ErrorAlert
                        code={agentRunErrorCode}
                        variant="destructive"
                        actions={[
                          {
                            key: "agentPreferences",
                            label: `${t("common.entities.agent")} ${t("common.settings")}`,
                            onClick: () => router.push("/preference/agent"),
                          },
                        ]}
                      />
                    </div>
                  ) : null}
                </div>
              </Card>

              {/* Composer */}
              <Card className={cn("min-h-0 overflow-hidden p-0 shadow-none rounded-md", composerSpan)}>
                <div className="flex h-full min-h-0 flex-col bg-background">
                  <InputGroup
                    className={cn(
                      "min-h-0 flex-1",
                      "has-[>textarea]:h-auto h-auto",
                      "!border-0 !shadow-none !bg-transparent dark:!bg-transparent",
                      "has-[[data-slot=input-group-control]:focus-visible]:!border-0 has-[[data-slot=input-group-control]:focus-visible]:!ring-0",
                    )}
                  >
                    <InputGroupTextarea
                      ref={setComposerRef}
                      value={session.input}
                      onChange={(e) => session.setInput(e.target.value)}
                      placeholder={t("workflows.orchestrator.composerPlaceholder")}
                      className={cn(
                        // Fill the card area and scroll internally (do NOT grow the page).
                        "min-h-0 flex-1 w-full px-3 text-base md:text-sm",
                        "py-3 resize-none rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent",
                        "overflow-y-auto",
                      )}
                      // Override the base Textarea `field-sizing-content` behavior so content never expands layout.
                      style={{ fieldSizing: "fixed" } as React.CSSProperties}
                      disabled={session.pending}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          void session.send()
                        }
                      }}
                    />

                    <InputGroupAddon align="block-end" className="order-last w-full justify-between px-3 pb-3">
                      <InputGroupButton
                        variant="outline"
                        size="icon-xs"
                        className="size-7 rounded-full p-0 dark:bg-input/30 dark:border-input dark:hover:bg-input/50"
                        aria-label={t("workflows.orchestrator.newChat")}
                        onClick={onNewChatClick}
                        disabled={session.pending || session.saving}
                      >
                        <Plus className="size-5" />
                      </InputGroupButton>

                      <InputGroupButton
                        variant="default"
                        size="icon-xs"
                        className="size-7 rounded-full p-0"
                        onClick={() => void session.send()}
                        disabled={session.pending || !session.input.trim()}
                        aria-label={t("workflows.orchestrator.sendAction")}
                      >
                        {session.pending ? <Spinner className="size-5" /> : <ArrowUp className="size-5" />}
                        <span className="sr-only">{t("workflows.orchestrator.sendAction")}</span>
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>
    </DetailPageLayout>
  )
}
