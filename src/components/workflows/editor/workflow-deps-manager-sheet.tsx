"use client"

import * as React from "react"
import { Pencil } from "lucide-react"
import { PackagePlus, Plus, RefreshCcw, RotateCcw, Trash2, XCircle } from "lucide-react"

import { ErrorAlert } from "@/components/common/error-alert"
import { LogViewer, type LogViewerLine } from "@/components/common/log-viewer"
import { SectionCard } from "@/components/common/section-card"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useI18n } from "@/components/i18n-provider"
import { InlineItemRow } from "@/components/common/inline-item-row"
import { useTopicStream } from "@/hooks/use-topic-stream"
import { toUiWorkflowDepsStatus, workflowDepsStatusUiSpec } from "@/lib/shared/workflow-deps-status"
import { makeStreamTopic } from "@/lib/shared/realtime/topics"
import { cn } from "@/lib/utils"
import { formatAbsoluteTime } from "@/lib/shared/format/time"
import { useTimezone } from "@/components/timezone-provider"

type DepsInstallLogRow = { id: string; level: string; createdAt: string; message: string }

type DepsRow = { id: string; name: string; version: string }

type DepsFailureBadge = { code: string; tooltip?: string } | null

function depsStatusLabel(status: string, t: ReturnType<typeof useI18n>["t"]) {
  switch (String(status || "").toUpperCase()) {
    case "NOT_CONFIGURED":
      return t("common.notConfigured")
    case "READY":
      return t("workflows.deps.status.ready")
    case "INSTALLING":
      return t("workflows.deps.status.installing")
    case "FAILED":
      return t("common.statusValues.failed")
    case "IDLE":
      return t("workflows.deps.status.install")
    default:
      return String(status || "")
  }
}

function parseDepsJsonToRows(depsJson: string): { rows: DepsRow[]; parseError?: string } {
  try {
    const obj = JSON.parse(depsJson || "{}")
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { rows: [] }

    const root = obj as Record<string, unknown>
    const out = new Map<string, string>()

    const ingest = (val: unknown) => {
      if (!val || typeof val !== "object" || Array.isArray(val)) return
      for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
        if (typeof v === "string") out.set(String(k), v)
      }
    }

    // Accept either:
    // - a flat map: { "pkg": "^1.0.0" }
    // - package.json-like: { dependencies: {...}, devDependencies: {...} }
    //
    // IMPORTANT: Only treat it as "package.json-like" if the sections are actually objects.
    // Otherwise keys like "dependencies" (as a package name) would incorrectly flip parsing to "sections"
    // and make the UI appear empty while the backend still sees deps.
    const isSectionObject = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v)
    const hasSections =
      isSectionObject(root.dependencies) ||
      isSectionObject(root.devDependencies) ||
      isSectionObject(root.optionalDependencies) ||
      isSectionObject(root.peerDependencies)
    if (hasSections) {
      if (isSectionObject(root.dependencies)) ingest(root.dependencies)
      if (isSectionObject(root.devDependencies)) ingest(root.devDependencies)
      if (isSectionObject(root.optionalDependencies)) ingest(root.optionalDependencies)
      if (isSectionObject(root.peerDependencies)) ingest(root.peerDependencies)
    } else ingest(root)

    const rows = [...out.entries()]
      .map(([name, version]) => ({ id: `dep:${name}`, name, version }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return { rows }
  } catch (e) {
    return { rows: [], parseError: e instanceof Error ? e.message : String(e) }
  }
}

function rowsToDepsJson(rows: DepsRow[]) {
  const obj: Record<string, string> = {}
  for (const r of rows) {
    const name = r.name.trim()
    const version = r.version.trim()
    if (!name || !version) continue
    obj[name] = version
  }
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)))
  return JSON.stringify(sorted, null, 2)
}

function normalizeDepsJsonString(s: string) {
  const parsed = parseDepsJsonToRows(s || "{}")
  return rowsToDepsJson(parsed.rows)
}

function DepsTableEditor(props: {
  /** Draft deps JSON */
  value: string
  /** Draft change */
  onChange: (v: string) => void
  /** Saved deps JSON (used for Reset + dirty UI) */
  savedValue: string
  error: string | null
  onErrorChange: (e: string | null) => void
  depsStatus?: string
  /** When set, bypasses UI-derived status logic (e.g. dirty/configured) */
  overrideStatus?: string | null
  /** Install failure detail to render in the footer (shown when status is FAILED and there's no draft error) */
  installFailureDetail?: string | null
  /** Disable whole editor while installing */
  uiDisabled: boolean
}) {
  const { t } = useI18n()

  // Consider "dirty" only when there is a meaningful (valid) dependency change.
  // Adding an empty row or partially-filled row does not change the serialized deps JSON,
  // and should NOT flip the status to "Install required".
  const dirty = normalizeDepsJsonString(props.value) !== normalizeDepsJsonString(props.savedValue)

  const [rows, setRows] = React.useState<DepsRow[]>([])
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set())
  const lastValueRef = React.useRef<string | null>(null)

  // Initialize/sync from props.value (e.g. initial load or server refresh after install).
  React.useEffect(() => {
    if (lastValueRef.current === props.value) return
    lastValueRef.current = props.value
    const parsed = parseDepsJsonToRows(props.value)
    if (parsed.parseError) props.onErrorChange(parsed.parseError)
    setRows(parsed.rows)
    setSelectedIds(new Set())
  }, [props.value])

  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id))
  const someSelected = rows.some((r) => selectedIds.has(r.id))
  const headerChecked: boolean | "indeterminate" = allSelected ? true : someSelected ? "indeterminate" : false

  const validateAndEmit = React.useCallback(
    (nextRows: DepsRow[]) => {
      // basic validation: non-empty names can't contain spaces; no duplicates
      const seen = new Set<string>()
      for (const r of nextRows) {
        const name = r.name.trim()
        if (!name) continue
        if (/\s/.test(name)) {
          props.onErrorChange(t("workflows.deps.errors.whitespaceName", { name }))
          return
        }
        if (seen.has(name)) {
          props.onErrorChange(t("workflows.deps.errors.duplicateName", { name }))
          return
        }
        seen.add(name)
      }

      props.onErrorChange(null)
      const json = rowsToDepsJson(nextRows)
      lastValueRef.current = json
      props.onChange(json)
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

  function addRow() {
    const id = `tmp:${Date.now().toString(36)}:${Math.random().toString(16).slice(2, 8)}`
    const next = [...rows, { id, name: "", version: "" }]
    setRows(next)
    // do not emit until it becomes valid (empty name/version are ignored by serializer)
    validateAndEmit(next)
  }

  function deleteSelected() {
    if (!selectedIds.size) return
    const next = rows.filter((r) => !selectedIds.has(r.id))
    setRows(next)
    setSelectedIds(new Set())
    validateAndEmit(next)
  }

  function updateRow(id: string, patch: Partial<Pick<DepsRow, "name" | "version">>) {
    const next = rows.map((r) => (r.id === id ? { ...r, ...patch } : r))
    setRows(next)
    validateAndEmit(next)
  }

  // Consider "configured" only when there's at least one meaningful dep (name + version).
  // Partially-filled rows should not flip the UI into READY (they also don't serialize to JSON).
  const configured = rows.some(
    (r) => String(r.name || "").trim().length > 0 && String(r.version || "").trim().length > 0,
  )

  // Status badge reflects installed state only (UI-only derive: configured/dirty).
  const depsStatusForBadge = props.overrideStatus
    ? String(props.overrideStatus)
    : toUiWorkflowDepsStatus(props.depsStatus ?? "", { dirty, configured })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 min-w-0">
      <SectionCard className="flex flex-col bg-background min-w-0">
        <div className="min-h-0 flex-1 overflow-y-auto min-w-0">
          <Table className="w-full table-fixed">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-[44px]">
                  <div className="flex items-center justify-center">
                    <Checkbox
                      aria-label={t("workflows.deps.actions.selectAllAction")}
                      checked={headerChecked}
                      onCheckedChange={(v) => toggleSelectAll(v === true)}
                      disabled={props.uiDisabled}
                    />
                  </div>
                </TableHead>
                <TableHead className="w-1/2">{t("workflows.deps.columns.name")}</TableHead>
                <TableHead className="w-1/2">{t("workflows.deps.columns.version")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length ? (
                rows.map((r) => {
                  const selected = selectedIds.has(r.id)
                  return (
                    <TableRow key={r.id} data-state={selected ? "selected" : undefined}>
                      <TableCell className="w-[44px]">
                        <div className="flex items-center justify-center">
                          <Checkbox
                            aria-label={`${t("workflows.deps.actions.selectRowAction")}${r.name ? `: ${r.name}` : ""}`}
                            checked={selected}
                            onCheckedChange={(v) => toggleRow(r.id, v === true)}
                            disabled={props.uiDisabled}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="min-w-0 w-1/2">
                        <Input
                          value={r.name}
                          onChange={(e) => updateRow(r.id, { name: e.target.value })}
                          placeholder="@scope/name"
                          className="w-full min-w-[100px] font-mono text-xs"
                          disabled={props.uiDisabled}
                        />
                      </TableCell>
                      <TableCell className="min-w-0 w-1/2">
                        <Input
                          value={r.version}
                          onChange={(e) => updateRow(r.id, { version: e.target.value })}
                          placeholder="^1.0.0"
                          className="w-full min-w-[100px] font-mono text-xs"
                          disabled={props.uiDisabled}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-xs text-muted-foreground whitespace-normal">
                    {t("workflows.deps.empty")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            {(() => {
              // Error has top priority: if the current draft is invalid, we should NOT claim "ready" or "install required".
              if (props.error) {
                return (
                  <InlineItemRow
                    className={cn(
                      "inline-flex text-sm",
                      "maia-status-badge--failed",
                      "text-[color:var(--maia-status-text)]",
                    )}
                    iconSizeClassName="size-4"
                    items={[
                      {
                        key: "depsDraftError",
                        Icon: XCircle,
                        text: String(props.error),
                        textClassName: "whitespace-normal break-words",
                      },
                    ]}
                  />
                )
              }

              const ui = workflowDepsStatusUiSpec(depsStatusForBadge)
              const label = depsStatusLabel(ui.status, t)
              // If deps are dirty, the primary CTA becomes "Install required"; don't keep showing stale
              // failure detail from a previous install attempt.
              const showFailureDetail = ui.status === "FAILED" && !dirty && !!props.installFailureDetail
              return (
                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                  <InlineItemRow
                    className={cn("inline-flex text-sm min-w-0", ui.varsClassName, ui.textClassName)}
                    iconSizeClassName="size-4"
                    wrap={false}
                    items={[
                      {
                        key: "depsStatus",
                        Icon: ui.Icon ?? null,
                        iconClassName: cn("shrink-0", ui.iconClassName),
                        text: label,
                      },
                    ]}
                  />
                  {showFailureDetail ? (
                    <div
                      className="min-w-0 flex-1 text-sm text-destructive truncate"
                      title={String(props.installFailureDetail)}
                    >
                      {String(props.installFailureDetail)}
                    </div>
                  ) : null}
                </div>
              )
            })()}
            {selectedIds.size ? (
              <span className="text-sm text-muted-foreground whitespace-nowrap shrink-0">
                {t("workflows.selectedCount", { n: selectedIds.size })}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={addRow} disabled={props.uiDisabled}>
              <Plus className="size-4" />
              {t("workflows.deps.actions.addAction")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={props.uiDisabled || !selectedIds.size}
              onClick={() => deleteSelected()}
            >
              <Trash2 className="size-4" />
              {t("common.deleteAction")}
            </Button>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}

export function WorkflowDepsManagerSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger?: React.ReactElement

  workflowId: string
  depsDraftJson: string
  onDepsDraftJsonChange: (v: string) => void
  depsJson: string
  depsErr: string | null
  onDepsErrChange: (e: string | null) => void

  depsStatus: string
  depsFailureBadge?: DepsFailureBadge
  depsSavePending: boolean
  depsInstallPending?: boolean
  onSaveDepsDraft: (opts?: { silentToast?: boolean }) => void | Promise<void>

  depsInstallErr: unknown
  onInstallDeps: () => void | Promise<void>
  activeTab: "deps" | "logs"
  onActiveTabChange: (tab: "deps" | "logs") => void
  loadLogs: () => Promise<{ logs: DepsInstallLogRow[] }>

  contentRef: React.RefObject<HTMLDivElement | null>
}) {
  const { t } = useI18n()
  const dirty = normalizeDepsJsonString(props.depsDraftJson) !== normalizeDepsJsonString(props.depsJson)
  const [installPending, setInstallPending] = React.useState(false)

  const depsCount = React.useMemo(() => {
    // Count "meaningful" deps (rowsToDepsJson ignores empty/partial rows).
    const normalized = normalizeDepsJsonString(props.depsDraftJson || "{}")
    return parseDepsJsonToRows(normalized).rows.length
  }, [props.depsDraftJson])

  const installing = props.depsInstallPending === true || props.depsStatus === "INSTALLING" || installPending
  const uiDisabled = installing
  const noDepsAndReady = depsCount === 0 && !dirty && props.depsStatus === "READY"
  const installDisabled =
    !props.onInstallDeps || !!props.depsSavePending || !!props.depsErr || installing || noDepsAndReady
  const resetDisabled = uiDisabled || !!props.depsSavePending || !dirty

  async function runInstall() {
    if (installDisabled) return
    setInstallPending(true)
    try {
      if (dirty) await props.onSaveDepsDraft({ silentToast: true })
      await props.onInstallDeps()
    } finally {
      setInstallPending(false)
    }
  }

  function runReset() {
    if (resetDisabled) return
    props.onDepsErrChange(null)
    props.onDepsDraftJsonChange(props.depsJson)
  }

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
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">{t("workflows.dependencies")}</SheetTitle>
          <SheetDescription>{t("workflows.deps.dialogDescription")}</SheetDescription>
        </SheetHeader>
        <Tabs
          value={props.activeTab}
          onValueChange={(v) => props.onActiveTabChange(v === "logs" ? "logs" : "deps")}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="px-4">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="deps" className="flex-0">
                {t("workflows.dependencies")}
              </TabsTrigger>
              <TabsTrigger value="logs" className="flex-0">
                {t("workflows.deps.logsTab")}
                {props.depsStatus === "FAILED" ? (
                  <span className="ml-1 inline-block size-2 rounded-full bg-destructive" />
                ) : null}
                {props.depsStatus === "INSTALLING" ? (
                  <span className="ml-1 inline-block size-2 rounded-full bg-amber-500" />
                ) : null}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="deps" className="flex min-h-0 flex-1 flex-col p-4 pt-0">
            <DepsTableEditor
              value={props.depsDraftJson}
              onChange={props.onDepsDraftJsonChange}
              savedValue={props.depsJson}
              error={props.depsErr}
              onErrorChange={props.onDepsErrChange}
              depsStatus={props.depsStatus}
              overrideStatus={installing ? "INSTALLING" : null}
              installFailureDetail={(() => {
                // Prefer API-call error (e.g. install endpoint unreachable) when present.
                if (props.depsInstallErr) {
                  if (props.depsInstallErr instanceof Error && props.depsInstallErr.message)
                    return props.depsInstallErr.message
                  return String(props.depsInstallErr)
                }
                // If deps are dirty, the primary state is "Install required"; do not show stale failure detail.
                if (dirty) return null
                // Otherwise, show server-reported failure code/message (SSE / persisted state).
                if (props.depsStatus === "FAILED" && props.depsFailureBadge?.code) {
                  const code = String(props.depsFailureBadge.code)
                  const tip = props.depsFailureBadge.tooltip ? String(props.depsFailureBadge.tooltip) : ""
                  return tip ? `${code}: ${tip}` : code
                }
                return null
              })()}
              uiDisabled={uiDisabled}
            />
          </TabsContent>

          <TabsContent value="logs" className="flex min-h-0 flex-1 flex-col p-4 pt-0">
            <DepsInstallLogsPanel
              workflowId={props.workflowId}
              depsStatus={props.depsStatus}
              loadLogs={props.loadLogs}
            />
          </TabsContent>
        </Tabs>

        {/* Sheet bottom actions: Install -> Reset */}
        <SheetFooter className="border-t bg-background">
          <div className="flex flex-col gap-2">
            <Button type="button" size="sm" onClick={() => void runInstall()} disabled={installDisabled}>
              {installing ? <Spinner className="h-4 w-4" /> : <PackagePlus className="h-4 w-4" />}
              {t("workflows.deps.actions.installDeps")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => runReset()} disabled={resetDisabled}>
              <RotateCcw className="h-4 w-4" />
              {t("common.resetAction")}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function DepsInstallLogsPanel(props: {
  workflowId: string
  depsStatus?: string
  loadLogs: () => Promise<{ logs: DepsInstallLogRow[] }>
}) {
  const { t, locale } = useI18n()
  const { effectiveTimezone } = useTimezone()
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState<unknown>(null)
  const [logs, setLogs] = React.useState<DepsInstallLogRow[]>([])

  const loadingRef = React.useRef(false)

  const refresh = React.useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setErr(null)
    try {
      const res = await props.loadLogs()
      setLogs(res.logs ?? [])
    } catch (e) {
      setErr(e)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [props.loadLogs])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  useTopicStream({
    topic: props.workflowId ? makeStreamTopic("workflowDeps", props.workflowId) : null,
    enabled: !!props.workflowId,
    persistCursor: false,
    onMessage: (msg) => {
      if (msg.type === "deps_log") {
        const d = msg.data && typeof msg.data === "object" ? (msg.data as Record<string, unknown>) : null
        const idNum = typeof msg.id === "number" ? msg.id : null
        const id = idNum != null && Number.isFinite(idNum) ? `log:${idNum}` : null
        const level = d ? String(d.level ?? "INFO") : "INFO"
        const message = d ? String(d.message ?? "") : ""
        const createdAt = msg.ts ? String(msg.ts) : new Date().toISOString()
        if (!id || !message) return
        // If a new install attempt starts, clear old history so the panel stays focused.
        if (message.includes("pnpm install (prod) starting")) {
          setLogs([{ id, level, createdAt, message }])
          return
        }
        setLogs((prev) => (prev.some((x) => x.id === id) ? prev : [...prev, { id, level, createdAt, message }]))
        return
      }
      if (msg.type === "deps_status") {
        // Status changed; refresh snapshot so the panel stays consistent.
        void refresh()
      }
    },
  })

  const lines = React.useMemo<LogViewerLine[]>(
    () =>
      (logs ?? []).map((l) => ({
        id: l.id,
        ts: l.createdAt,
        level: l.level,
        line: l.message,
      })),
    [logs],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {err ? (
        <ErrorAlert
          error={err}
          actions={[{ key: "refresh", label: t("common.refreshAction"), onClick: () => void refresh() }]}
        />
      ) : null}

      <div className="min-h-0 flex-1 rounded-md border bg-background">
        <LogViewer
          lines={lines}
          empty={<div className="py-10 text-center text-sm text-muted-foreground">{t("workflows.deps.noLogs")}</div>}
          actions={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void refresh()}
              aria-label={t("common.refreshAction")}
              title={t("common.refreshAction")}
              className="h-8 w-8"
              disabled={loading}
            >
              <RefreshCcw className={loading ? "size-4 animate-spin" : "size-4"} />
            </Button>
          }
          getCopyText={(ls) =>
            ls
              .map(
                (x) =>
                  `${x.ts ? formatAbsoluteTime(x.ts, { locale, timeZone: effectiveTimezone }) : ""} [${String(
                    x.level ?? "INFO",
                  ).toUpperCase()}] ${x.line}`,
              )
              .join("\n")
          }
        />
      </div>
    </div>
  )
}
