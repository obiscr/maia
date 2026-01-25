"use client"

import * as React from "react"
import { Check, Copy, Eye, EyeOff, Pencil, Plus, RotateCcw, Save, Trash2 } from "lucide-react"

import { SectionCard } from "@/components/common/section-card"
import { Spinner } from "@/components/ui/spinner"
import { InlineItemRow } from "@/components/common/inline-item-row"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { SecretInput } from "@/components/ui/secret-input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useI18n } from "@/components/i18n-provider"
import { useCopyButton } from "@/hooks/use-copy-button"
import { toUiWorkflowEnvStatus, workflowEnvStatusUiSpec } from "@/lib/shared/workflow-env-status"
import { cn } from "@/lib/utils"

type EnvRow = { id: string; key: string; value: string }

// "Standard" environment variable name convention (POSIX-ish):
// - must start with a letter or underscore
// - then letters, digits, underscores
// Node.js process.env can technically contain other keys, but we enforce this for portability.
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const ENV_KEY_MAX_LEN = 128
const ENV_VALUE_MAX_LEN = 8192

function parseEnvJsonToRows(envJson: string): { rows: EnvRow[]; parseError?: string } {
  try {
    const obj = JSON.parse(envJson || "{}")
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { rows: [] }
    const rows = Object.entries(obj as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string")
      .map(([key, value]) => ({ id: `env:${key}`, key, value: String(value) }))
      .sort((a, b) => a.key.localeCompare(b.key))
    return { rows }
  } catch (e) {
    return { rows: [], parseError: e instanceof Error ? e.message : String(e) }
  }
}

function rowsToEnvJson(rows: EnvRow[]) {
  const obj: Record<string, string> = {}
  for (const r of rows) {
    const k = r.key.trim()
    if (!k) continue
    obj[k] = String(r.value ?? "")
  }
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)))
  return JSON.stringify(sorted, null, 2)
}

/**
 * Copy button component that uses the `useCopyButton` hook.
 * Each instance manages its own copied state independently.
 */
function CopyButton(props: { text: string; disabled?: boolean; className?: string; "aria-label": string }) {
  const { copied, handleCopy } = useCopyButton()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        "absolute right-1 top-1/2 -translate-y-1/2 bg-transparent hover:bg-transparent focus-visible:ring-0 focus-visible:border-transparent",
        props.className,
      )}
      onClick={() => handleCopy(props.text)}
      disabled={props.disabled}
      aria-label={props["aria-label"]}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </Button>
  )
}

export function WorkflowEnvManagerSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger?: React.ReactElement
  /** Draft env JSON */
  envDraftJson: string
  onEnvDraftJsonChange: (v: string) => void
  /** Saved env JSON */
  envJson: string
  envErr: string | null
  onEnvErrChange: (e: string | null) => void
  envSavePending: boolean
  onSaveEnvDraft: () => void | Promise<void>
  contentRef: React.RefObject<HTMLDivElement | null>
}) {
  const { t } = useI18n()

  const [rows, setRows] = React.useState<EnvRow[]>([])
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set())
  const [visibleValueIds, setVisibleValueIds] = React.useState<Set<string>>(() => new Set())
  const lastValueRef = React.useRef<string | null>(null)

  // Initialize/sync from props.envDraftJson.
  React.useEffect(() => {
    if (lastValueRef.current === props.envDraftJson) return
    lastValueRef.current = props.envDraftJson
    const parsed = parseEnvJsonToRows(props.envDraftJson)
    if (parsed.parseError) props.onEnvErrChange(parsed.parseError)
    setRows(parsed.rows)
    setSelectedIds(new Set())
    setVisibleValueIds(new Set())
  }, [props.envDraftJson])

  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id))
  const someSelected = rows.some((r) => selectedIds.has(r.id))
  const headerChecked: boolean | "indeterminate" = allSelected ? true : someSelected ? "indeterminate" : false

  const validateAndEmit = React.useCallback(
    (nextRows: EnvRow[]) => {
      const seen = new Set<string>()
      for (const r of nextRows) {
        const k = r.key.trim()
        if (!k) continue
        if (k.length > ENV_KEY_MAX_LEN) {
          props.onEnvErrChange(t("workflows.env.errors.keyTooLong", { key: k, max: ENV_KEY_MAX_LEN }))
          return
        }
        if (/\s/.test(k)) {
          props.onEnvErrChange(t("workflows.env.errors.whitespaceKey", { key: k }))
          return
        }
        if (!ENV_KEY_RE.test(k)) {
          props.onEnvErrChange(t("workflows.env.errors.invalidKeyFormat", { key: k }))
          return
        }
        if (seen.has(k)) {
          props.onEnvErrChange(t("workflows.env.errors.duplicateKey", { key: k }))
          return
        }
        seen.add(k)
        if (String(r.value ?? "").length > ENV_VALUE_MAX_LEN) {
          props.onEnvErrChange(t("workflows.env.errors.valueTooLong", { key: k, max: ENV_VALUE_MAX_LEN }))
          return
        }
      }
      props.onEnvErrChange(null)
      const json = rowsToEnvJson(nextRows)
      lastValueRef.current = json
      props.onEnvDraftJsonChange(json)
    },
    [props, t],
  )

  function toggleSelectAll(next: boolean) {
    setSelectedIds(() => {
      if (!next) return new Set()
      return new Set(rows.map((r) => r.id))
    })
  }

  function toggleRow(id: string, next: boolean) {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (next) n.add(id)
      else n.delete(id)
      return n
    })
  }

  function toggleValueVisibility(id: string) {
    setVisibleValueIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function addRow() {
    const id = `tmp:${Date.now().toString(36)}:${Math.random().toString(16).slice(2, 8)}`
    const next = [...rows, { id, key: "", value: "" }]
    setRows(next)
    validateAndEmit(next)
  }

  function updateRow(id: string, patch: Partial<Pick<EnvRow, "key" | "value">>) {
    const next = rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    setRows(next)
    validateAndEmit(next)
  }

  function deleteSelected() {
    if (!selectedIds.size) return
    const next = rows.filter((r) => !selectedIds.has(r.id))
    setRows(next)
    setSelectedIds(new Set())
    validateAndEmit(next)
  }

  function resetToSaved() {
    props.onEnvErrChange(null)
    props.onEnvDraftJsonChange(props.envJson || "{}")
  }

  const dirty = (props.envDraftJson || "{}").trim() !== (props.envJson || "{}").trim()
  const uiDisabled = !!props.envSavePending
  const resetDisabled = uiDisabled || !dirty
  const configured = rows.some((r) => String(r.key || "").trim().length > 0)

  const envUiStatus = toUiWorkflowEnvStatus({ configured, dirty, error: !!props.envErr })
  const envUi = workflowEnvStatusUiSpec(envUiStatus)
  const envStatusLabel =
    envUi.status === "FAILED"
      ? t("common.errorLabel")
      : envUi.status === "DIRTY"
        ? t("common.unsavedChanges")
        : envUi.status === "NOT_CONFIGURED"
          ? t("common.notConfigured")
          : t("workflows.deps.status.ready")

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetTrigger asChild>
        {props.trigger ?? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
            <Pencil className="size-3.5" aria-hidden="true" />
            {t("common.editAction")}
          </Button>
        )}
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full sm:max-w-3xl flex flex-col"
        ref={props.contentRef}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          requestAnimationFrame(() => {
            const root = props.contentRef.current
            if (!root) return
            const first =
              (root.querySelector(
                "input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
              ) as HTMLElement | null) ?? null
            first?.focus()
          })
        }}
      >
        <form
          className="contents"
          onSubmit={(e) => {
            // Avoid accidental saves when pressing Enter while editing rows.
            e.preventDefault()
          }}
        >
          <SheetHeader>
            <SheetTitle>{t("workflows.env.title")}</SheetTitle>
            <SheetDescription>{t("workflows.env.description")}</SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col p-4 pt-0">
            <div className="flex min-h-0 flex-1 flex-col gap-1 min-w-0">
              <SectionCard className="flex flex-col bg-background min-w-0">
                <div className="min-h-0 flex-1 overflow-y-auto min-w-0">
                  <Table className="w-full table-fixed">
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow>
                        <TableHead className="w-[44px]">
                          <div className="flex items-center justify-center">
                            <Checkbox
                              aria-label={t("workflows.env.actions.selectAllAction")}
                              checked={headerChecked}
                              onCheckedChange={(v) => toggleSelectAll(v === true)}
                              disabled={uiDisabled}
                            />
                          </div>
                        </TableHead>
                        <TableHead className="w-1/2">{t("workflows.env.columns.key")}</TableHead>
                        <TableHead className="w-1/2">{t("workflows.env.columns.value")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.length ? (
                        rows.map((r) => {
                          const selected = selectedIds.has(r.id)
                          const visible = visibleValueIds.has(r.id)
                          return (
                            <TableRow key={r.id} data-state={selected ? "selected" : undefined}>
                              <TableCell className="w-[44px]">
                                <div className="flex items-center justify-center">
                                  <Checkbox
                                    aria-label={`${t("workflows.env.actions.selectRowAction")}${r.key ? `: ${r.key}` : ""}`}
                                    checked={selected}
                                    onCheckedChange={(v) => toggleRow(r.id, v === true)}
                                    disabled={uiDisabled}
                                  />
                                </div>
                              </TableCell>
                              <TableCell className="min-w-0 w-1/2">
                                <div className="relative">
                                  <Input
                                    value={r.key}
                                    onChange={(e) => updateRow(r.id, { key: e.target.value })}
                                    placeholder="MY_API_KEY"
                                    className="w-full min-w-[120px] pr-9 font-mono text-xs"
                                    disabled={uiDisabled}
                                  />
                                  <CopyButton
                                    text={r.key ?? ""}
                                    disabled={uiDisabled}
                                    aria-label={t("common.copyAction")}
                                  />
                                </div>
                              </TableCell>
                              <TableCell className="min-w-0 w-1/2">
                                <div className="relative">
                                  <SecretInput
                                    value={r.value}
                                    onChange={(e) => updateRow(r.id, { value: e.target.value })}
                                    placeholder="VALUE"
                                    className="w-full min-w-[160px] pr-20 font-mono text-xs"
                                    disabled={uiDisabled}
                                    masked={!visible}
                                  />
                                  <CopyButton
                                    text={r.value ?? ""}
                                    disabled={uiDisabled}
                                    className="right-9"
                                    aria-label={t("common.copyAction")}
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="absolute right-1 top-1/2 -translate-y-1/2 bg-transparent hover:bg-transparent focus-visible:ring-0 focus-visible:border-transparent"
                                    onClick={() => toggleValueVisibility(r.id)}
                                    disabled={uiDisabled}
                                    aria-label={
                                      visible
                                        ? t("workflows.env.actions.hideValue")
                                        : t("workflows.env.actions.showValue")
                                    }
                                  >
                                    {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={3}
                            className="py-8 text-center text-xs text-muted-foreground whitespace-normal"
                          >
                            {t("workflows.env.empty")}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Table bottom toolbar: Add/Delete */}
                <div className="flex items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={cn("flex min-w-0 flex-1 items-center gap-2 overflow-hidden", envUi.varsClassName)}>
                      <InlineItemRow
                        className={cn("inline-flex text-sm min-w-0", envUi.varsClassName, envUi.textClassName)}
                        iconSizeClassName="size-4"
                        wrap={false}
                        items={[
                          {
                            key: "envStatus",
                            Icon: envUi.Icon ?? null,
                            iconClassName: cn("shrink-0", envUi.iconClassName),
                            text: envStatusLabel,
                          },
                        ]}
                      />
                      {envUi.status === "FAILED" && props.envErr ? (
                        <div
                          className={cn("min-w-0 flex-1 text-sm truncate", envUi.textClassName)}
                          title={String(props.envErr)}
                        >
                          {String(props.envErr)}
                        </div>
                      ) : null}
                    </div>
                    {selectedIds.size ? (
                      <span className="text-sm text-muted-foreground whitespace-nowrap shrink-0">
                        {t("workflows.selectedCount", { n: selectedIds.size })}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={addRow} disabled={uiDisabled}>
                      <Plus className="size-4" />
                      {t("workflows.env.actions.addAction")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      disabled={uiDisabled || !selectedIds.size}
                      onClick={() => deleteSelected()}
                    >
                      <Trash2 className="size-4" />
                      {t("common.deleteAction")}
                    </Button>
                  </div>
                </div>
              </SectionCard>
            </div>
          </div>

          {/* Sheet bottom actions: Save -> Reset */}
          <SheetFooter className="border-t bg-background">
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => props.onSaveEnvDraft()}
                disabled={uiDisabled || !!props.envErr}
              >
                {props.envSavePending ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                {props.envSavePending ? t("common.saving") : t("common.saveAction")}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={resetToSaved} disabled={resetDisabled}>
                <RotateCcw className="h-4 w-4" />
                {t("common.resetAction")}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
