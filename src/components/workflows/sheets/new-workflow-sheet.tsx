"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { useI18n } from "@/components/i18n-provider"
import { Spinner } from "@/components/ui/spinner"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PageBlocker } from "@/components/ui/page-blocker"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { TextareaWithChrome } from "@/components/common/textarea-with-chrome"
import { toast } from "@/lib/client/toast"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"

function normalizeOptionalText(v: string) {
  const trimmed = v.trim()
  return trimmed.length ? trimmed : undefined
}

export function NewWorkflowSheet(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n()
  const router = useRouter()
  const defaultName = t("workflows.newWorkflowName")
  const defaultNameRef = React.useRef(defaultName)

  const [name, setName] = React.useState(defaultName)
  const [description, setDescription] = React.useState("")
  const [creating, setCreating] = React.useState(false)

  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const prevOpenRef = React.useRef<boolean>(props.open)

  React.useEffect(() => {
    if (name === defaultNameRef.current) setName(defaultName)
    defaultNameRef.current = defaultName
  }, [defaultName, name])

  React.useEffect(() => {
    const prev = prevOpenRef.current
    prevOpenRef.current = props.open
    if (!prev && props.open) {
      setName(defaultName)
      setDescription("")
    }
  }, [props.open, defaultName])

  async function create(payload: unknown) {
    if (creating) return
    setCreating(true)
    try {
      const json = await apiFetchJson<{ workflow?: { id: string } }>("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!json.workflow?.id) throw new Error("Missing workflow id")
      toast.success(t("workflows.createdToast"))
      router.push(`/workflows/${json.workflow.id}`)
      return
    } catch (e: unknown) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.error" }))
      setCreating(false)
      return
    }
  }

  async function createEmpty() {
    return create({
      name,
      description: normalizeOptionalText(description),
      dependencies: "{}",
      steps: [],
    })
  }

  async function createFromDraft() {
    return createEmpty()
  }

  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (creating) return
        props.onOpenChange(open)
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl flex flex-col"
        ref={contentRef}
        aria-busy={creating}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          requestAnimationFrame(() => {
            const root = contentRef.current
            if (!root) return
            const first =
              (root.querySelector(
                "input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
              ) as HTMLElement | null) ?? null
            first?.focus()
          })
        }}
      >
        <PageBlocker active={creating} />

        <SheetHeader>
          <SheetTitle>{t("workflows.newWorkflow")}</SheetTitle>
          <SheetDescription>{t("workflows.newWorkflowDescription")}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto p-4 pt-0">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="wf-name">{t("workflows.name")}</FieldLabel>
              <Input
                id="wf-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full"
                autoComplete="off"
                disabled={creating}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="wf-description">
                {t("workflows.description")} <span className="font-normal">({t("common.optional")})</span>
              </FieldLabel>
              <TextareaWithChrome
                id="wf-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("workflows.description")}
                rows={6}
                className="max-h-40"
                disabled={creating}
              />
            </Field>
          </FieldGroup>
        </div>

        <SheetFooter className="border-t bg-background">
          <div className="flex flex-col gap-2">
            <Button size="sm" onClick={createFromDraft} disabled={!name.trim() || creating}>
              {creating ? <Spinner className="h-4 w-4" /> : null}
              {t("common.createAction")}
            </Button>
            <SheetClose asChild>
              <Button size="sm" variant="outline" disabled={creating}>
                {t("common.cancelAction")}
              </Button>
            </SheetClose>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
