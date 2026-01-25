"use client"

import * as React from "react"
import {
  AlertCircleIcon,
  Boxes,
  Clock,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Hash,
  KeyRound,
  ListTree,
  Package,
  Tag,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SecretInput } from "@/components/ui/secret-input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { JsonViewer } from "@/components/common/json-viewer"
import { SectionCard, SectionCardBody, SectionCardHeader } from "@/components/common/section-card"
import { useI18n } from "@/components/i18n-provider"
import { copyTextToClipboard } from "@/lib/client/clipboard"
import { toast } from "@/lib/client/toast"
import { WorkflowStepsCodePreview } from "@/components/workflows/common/workflow-steps-code-preview"
import { formatAbsoluteTime } from "@/lib/shared/format/time"
import { useTimezone } from "@/components/timezone-provider"

type DepsRow = { name: string; version: string }
type EnvRow = { key: string; value: string }

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

    // Treat as package.json-like only when section values are objects.
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
      .map(([name, version]) => ({ name, version }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { rows }
  } catch (e) {
    return { rows: [], parseError: e instanceof Error ? e.message : String(e) }
  }
}

function parseEnvJsonToRows(envJson: string): { rows: EnvRow[]; parseError?: string } {
  try {
    const obj = JSON.parse(envJson || "{}")
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { rows: [] }
    const rows = Object.entries(obj as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string")
      .map(([key, value]) => ({ key, value: String(value) }))
      .sort((a, b) => a.key.localeCompare(b.key))
    return { rows }
  } catch (e) {
    return { rows: [], parseError: e instanceof Error ? e.message : String(e) }
  }
}

export function WorkflowVersionSnapshotTabsPanel(props: {
  className?: string
  versionTitle: string
  createdAt: string | null
  depsHash: string | null
  description: string | null

  steps: Array<{ stepKey: string; name: string; timeoutMs: number; scriptEsm: string }>
  dependencies: string | null
  envJson: string | null
  inputSpec: string | null
  outputsSpec: string | null
}) {
  const { t, locale } = useI18n()
  const { effectiveTimezone } = useTimezone()

  const noteText = (props.description ?? "").trim()

  const [tab, setTab] = React.useState<"steps" | "deps" | "env" | "inputSpec" | "outputsSpec">("steps")
  const [visibleEnvKeys, setVisibleEnvKeys] = React.useState<Set<string>>(() => new Set())

  const deps = React.useMemo(() => parseDepsJsonToRows(props.dependencies ?? "{}"), [props.dependencies])
  const env = React.useMemo(() => parseEnvJsonToRows(props.envJson ?? "{}"), [props.envJson])

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        // Prevent accidental submit on Enter in secret inputs.
        e.preventDefault()
      }}
    >
      <SectionCard className={props.className}>
        <SectionCardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1 text-sm font-semibold">
              <Tag className="size-3.5" aria-hidden="true" />
              <span>{props.versionTitle}</span>
            </div>
            {noteText.length ? (
              <Badge variant="secondary" className="h-6 max-w-[520px] font-mono text-xs" title={noteText}>
                <span className="inline-flex min-w-0 items-center gap-1">
                  <FileText className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    {t("common.note")}:{noteText}
                  </span>
                </span>
              </Badge>
            ) : null}
            {props.depsHash ? (
              <Badge variant="secondary" className="h-6 font-mono text-xs">
                <span className="inline-flex items-center gap-1">
                  <Hash className="size-3.5" aria-hidden="true" />
                  {t("workflows.versions.depsHashLabel")}:{String(props.depsHash).slice(0, 8)}
                </span>
              </Badge>
            ) : null}
            {props.createdAt ? (
              <Badge variant="secondary" className="h-6 font-mono text-xs">
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" aria-hidden="true" />
                  {t("workflows.versions.createdAtBadge", {
                    ts: formatAbsoluteTime(props.createdAt, { locale, timeZone: effectiveTimezone }),
                  })}
                </span>
              </Badge>
            ) : null}
          </div>
        </SectionCardHeader>

        <SectionCardBody className="overflow-hidden">
          <Tabs
            value={tab}
            onValueChange={(v) =>
              setTab(
                v === "steps" || v === "deps" || v === "env" || v === "inputSpec" || v === "outputsSpec" ? v : "steps",
              )
            }
            className="flex h-full min-h-0 flex-col gap-0"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
              <div className="min-w-0 flex-1 overflow-x-auto">
                <TabsList className="w-max">
                  <TabsTrigger value="steps" className="flex-none sm:flex-1">
                    <span className="inline-flex items-center gap-1">
                      <ListTree className="size-3.5" aria-hidden="true" />
                      {t("common.steps")}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="deps" className="flex-none sm:flex-1">
                    <span className="inline-flex items-center gap-1">
                      <Package className="size-3.5" aria-hidden="true" />
                      {t("workflows.dependencies")}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="env" className="flex-none sm:flex-1">
                    <span className="inline-flex items-center gap-1">
                      <KeyRound className="size-3.5" aria-hidden="true" />
                      {t("workflows.env.title")}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="inputSpec" className="flex-none sm:flex-1">
                    <span className="inline-flex items-center gap-1">
                      <FileText className="size-3.5" aria-hidden="true" />
                      {t("workflows.inputSpec.title")}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="outputsSpec" className="flex-none sm:flex-1">
                    <span className="inline-flex items-center gap-1">
                      <Boxes className="size-3.5" aria-hidden="true" />
                      {t("workflows.outputsSpec.title")}
                    </span>
                  </TabsTrigger>
                </TabsList>
              </div>
            </div>

            <TabsContent value="steps" className="min-h-0">
              <WorkflowStepsCodePreview
                className="h-full min-h-0"
                layout="responsive"
                steps={props.steps}
                emptyText={t("workflows.versions.stepsEmpty")}
              />
            </TabsContent>

            <TabsContent value="deps" className="min-h-0">
              <ScrollArea className="h-full">
                <div>
                  {env.parseError ? (
                    <div className="border-b p-3">
                      <Alert variant="destructive">
                        <AlertCircleIcon />
                        <AlertTitle>Dependencies error</AlertTitle>
                        <AlertDescription>{deps.parseError}</AlertDescription>
                      </Alert>
                    </div>
                  ) : null}
                  <Table className="w-full table-fixed">
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow>
                        <TableHead className="w-1/2">{t("workflows.deps.columns.name")}</TableHead>
                        <TableHead className="w-1/2">{t("workflows.deps.columns.version")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deps.rows.length ? (
                        deps.rows.map((r) => (
                          <TableRow key={r.name}>
                            <TableCell className="min-w-0 w-1/2">
                              <Input value={r.name} readOnly className="h-8 w-full min-w-[120px] font-mono text-xs" />
                            </TableCell>
                            <TableCell className="min-w-0 w-1/2">
                              <Input
                                value={r.version}
                                readOnly
                                className="h-8 w-full min-w-[120px] font-mono text-xs"
                              />
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={2}
                            className="py-8 text-center text-xs text-muted-foreground whitespace-normal"
                          >
                            {t("workflows.deps.empty")}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="env" className="min-h-0">
              <ScrollArea className="h-full">
                <div>
                  {env.parseError ? (
                    <div className="border-b p-3">
                      <Alert variant="destructive">
                        <AlertCircleIcon />
                        <AlertTitle>Environment error</AlertTitle>
                        <AlertDescription>{env.parseError}</AlertDescription>
                      </Alert>
                    </div>
                  ) : null}
                  <Table className="w-full table-fixed">
                    <TableHeader className="sticky top-0 z-10 bg-background">
                      <TableRow>
                        <TableHead className="w-1/2">{t("workflows.env.columns.key")}</TableHead>
                        <TableHead className="w-1/2">{t("workflows.env.columns.value")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {env.rows.length ? (
                        env.rows.map((r) => {
                          const visible = visibleEnvKeys.has(r.key)
                          return (
                            <TableRow key={r.key}>
                              <TableCell className="min-w-0 w-1/2">
                                <div className="relative">
                                  <Input
                                    value={r.key}
                                    readOnly
                                    className="h-8 w-full min-w-[120px] pr-9 font-mono text-xs"
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="absolute right-1 top-1/2 -translate-y-1/2 bg-transparent hover:bg-transparent focus-visible:ring-0 focus-visible:border-transparent"
                                    onClick={async () => {
                                      try {
                                        await copyTextToClipboard(r.key)
                                        toast(t("common.copied"))
                                      } catch {
                                        toast.error(t("common.copyActionFailed"))
                                      }
                                    }}
                                    aria-label={t("common.copyAction")}
                                  >
                                    <Copy className="size-4" />
                                  </Button>
                                </div>
                              </TableCell>
                              <TableCell className="min-w-0 w-1/2">
                                <div className="relative">
                                  <SecretInput
                                    value={r.value}
                                    readOnly
                                    masked={!visible}
                                    className="h-8 w-full min-w-[160px] pr-20 font-mono text-xs"
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="absolute right-9 top-1/2 -translate-y-1/2 bg-transparent hover:bg-transparent focus-visible:ring-0 focus-visible:border-transparent"
                                    onClick={async () => {
                                      try {
                                        await copyTextToClipboard(r.value)
                                        toast(t("common.copied"))
                                      } catch {
                                        toast.error(t("common.copyActionFailed"))
                                      }
                                    }}
                                    aria-label={t("common.copyAction")}
                                  >
                                    <Copy className="size-4" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="absolute right-1 top-1/2 -translate-y-1/2 bg-transparent hover:bg-transparent focus-visible:ring-0 focus-visible:border-transparent"
                                    onClick={() => {
                                      setVisibleEnvKeys((prev) => {
                                        const n = new Set(prev)
                                        if (n.has(r.key)) n.delete(r.key)
                                        else n.add(r.key)
                                        return n
                                      })
                                    }}
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
                            colSpan={2}
                            className="py-8 text-center text-xs text-muted-foreground whitespace-normal"
                          >
                            {t("workflows.env.empty")}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="inputSpec" className="min-h-0">
              <div className="h-full">
                <JsonViewer value={props.inputSpec} />
              </div>
            </TabsContent>

            <TabsContent value="outputsSpec" className="min-h-0">
              <div className="h-full">
                <JsonViewer value={props.outputsSpec} />
              </div>
            </TabsContent>
          </Tabs>
        </SectionCardBody>
      </SectionCard>
    </form>
  )
}
