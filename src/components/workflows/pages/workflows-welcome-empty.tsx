"use client"

import type * as React from "react"
import { ArrowUp, Bot } from "lucide-react"

import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { WorkflowQuickExamples } from "@/components/workflows/common/workflow-quick-examples"
import type { TFunction } from "@/lib/shared/i18n/t"
import { cn } from "@/lib/utils"

const DEFAULT_MAX_PROMPT_CHARS = 4000

export function WorkflowsWelcomeEmpty(props: {
  t: TFunction
  prompt: string
  setPrompt: (next: string) => void
  promptRef: React.RefObject<HTMLTextAreaElement | null>
  onSubmit: () => void
  maxPromptChars?: number
  /** When false, avoids using viewport-based min-height (useful inside dialogs). */
  fullHeight?: boolean
}) {
  const {
    t,
    prompt,
    setPrompt,
    promptRef,
    onSubmit,
    maxPromptChars = DEFAULT_MAX_PROMPT_CHARS,
    fullHeight = true,
  } = props

  return (
    <div className={cn(fullHeight ? "min-h-[calc(100vh-260px)]" : "min-h-0 py-10", "flex items-center justify-center")}>
      <div className="w-full max-w-3xl px-3">
        <Empty className="w-full border-0 p-0 md:p-0">
          <div className="w-full p-2 md:p-4 space-y-6 text-left">
            <EmptyHeader className="mx-auto">
              <EmptyMedia variant="icon">
                <Bot className="h-5 w-5" aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{t("workflows.emptyTitle")}</EmptyTitle>
            </EmptyHeader>
            <EmptyContent className="mx-auto max-w-2xl text-wrap">
              <InputGroup className="has-[>textarea]:h-auto h-auto">
                <InputGroupTextarea
                  ref={promptRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value.slice(0, maxPromptChars))}
                  placeholder={t("workflows.orchestrator.composerPlaceholder")}
                  className={cn(
                    "field-sizing-content min-h-30 w-full px-3 text-base md:text-sm text-wrap",
                    "py-3 flex-1 resize-none rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent",
                  )}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      onSubmit()
                    }
                  }}
                />
                <InputGroupAddon align="block-end" className="order-last w-full justify-end px-3 pb-3">
                  <InputGroupButton
                    variant="default"
                    size="icon-xs"
                    className="size-8 p-0 rounded-full"
                    onClick={onSubmit}
                    disabled={!prompt.trim()}
                  >
                    <ArrowUp className="size-5" />
                    <span className="sr-only">{t("workflows.orchestrator.sendAction")}</span>
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>

              <div className="pt-3">
                <WorkflowQuickExamples
                  count={10}
                  layout="wrap"
                  behavior="fill"
                  className="justify-center"
                  onPick={(text) => {
                    setPrompt(text)
                    requestAnimationFrame(() => promptRef.current?.focus())
                  }}
                />
              </div>
            </EmptyContent>
          </div>
        </Empty>
      </div>
    </div>
  )
}
