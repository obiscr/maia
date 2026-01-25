"use client"

import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Download,
  Globe,
  type LucideIcon,
  Upload,
  XCircle,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { toast } from "@/lib/client/toast"
import { useI18nOptional } from "@/components/i18n-provider"
import { tError } from "@/lib/shared/i18n/error"
import { ScrollBar } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item"
import { Badge } from "@/components/ui/badge"

export type FileViewerFile = {
  id?: string | number
  name?: string | null
  downloadName?: string | null
  titleIcon?: "input" | "output" | null
  path?: string | null
  url?: string | null
  source?: string | null
  status?: string | null
  error?: string | null
  downloadHref?: string | null
  downloadDisabled?: boolean | null
  // Retry removed by design: keep fields for backwards compatibility with callers,
  // but UI intentionally does not render a retry action anymore.
  onRetryDownload?: (() => void | Promise<void>) | null
  retryDisabled?: boolean | null
}

function fileKey(f: FileViewerFile, idx: number) {
  return String(f.id ?? `${f.source ?? "file"}:${f.url ?? f.path ?? ""}:${idx}`)
}

function filePathLabel(f: FileViewerFile) {
  const s = String(f?.status ?? "").toLowerCase()
  // If a file failed, prefer showing the original URL (local path may not exist).
  if (s === "failed") return f.url ?? f.path ?? "—"
  return f.path ?? f.url ?? "—"
}

function sourceBadgeSpec(source: string | null | undefined) {
  const s = String(source ?? "").toLowerCase()
  if (!s) return null
  if (s === "upload") return { labelKey: "common.fileViewer.source.upload", Icon: Upload }
  if (s === "url") return { labelKey: "common.fileViewer.source.url", Icon: Globe }
  return { labelKey: "common.fileViewer.source.unknown", Icon: null as LucideIcon | null }
}

function statusBadgeSpec(status: string | null | undefined) {
  const s = String(status ?? "").toLowerCase()
  if (s === "ready")
    return {
      labelKey: "common.fileViewer.status.ready",
      Icon: CheckCircle2,
      className: "maia-status-badge maia-status-badge--success",
    }
  if (s === "fetching")
    return {
      labelKey: "common.fileViewer.status.fetching",
      Icon: Spinner,
      className: "maia-status-badge maia-status-badge--running",
    }
  if (s === "failed")
    return {
      labelKey: "common.fileViewer.status.failed",
      Icon: XCircle,
      className: "maia-status-badge maia-status-badge--error",
    }
  return {
    labelKey: "common.fileViewer.status.unknown",
    Icon: null as LucideIcon | null,
    className: "maia-status-badge maia-status-badge--unknown",
  }
}

export function FileViewer(props: { files: FileViewerFile[]; className?: string; empty?: React.ReactNode }) {
  const i18n = useI18nOptional()
  const t = i18n?.t ?? ((key: string) => key)

  const empty = props.empty ?? <div className="p-4 text-sm text-muted-foreground">—</div>
  const files = Array.isArray(props.files) ? props.files : []
  const [busyKeys, setBusyKeys] = React.useState<Set<string>>(() => new Set())

  async function handleDownloadClick(f: FileViewerFile) {
    const href = typeof f?.downloadHref === "string" && f.downloadHref ? f.downloadHref : null
    if (!href) return

    const status = String(f?.status ?? "").toLowerCase()
    if (status === "fetching" || status === "failed") return

    const isExternal = /^https?:\/\//i.test(href)
    const a = document.createElement("a")
    a.href = href
    a.target = "_blank"
    a.rel = isExternal ? "noopener noreferrer" : "noopener"
    a.style.display = "none"
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const content =
    files.length === 0 ? (
      empty
    ) : (
      <ItemGroup>
        {files.map((f, idx) => (
          <React.Fragment key={fileKey(f, idx)}>
            <Item size="sm" className="px-3 py-2">
              <ItemContent className="min-w-0">
                {/* `ItemTitle` defaults to `w-fit`, which breaks truncation. Force a full-width, shrinkable title row. */}
                <ItemTitle className="min-w-0 w-full max-w-full overflow-hidden">
                  {(() => {
                    const iconKey = f?.titleIcon ?? null
                    const Icon = iconKey === "input" ? ArrowDownLeft : iconKey === "output" ? ArrowUpRight : null
                    return (
                      <span className="min-w-0 flex items-center gap-2">
                        {Icon ? <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
                        <span className="min-w-0 flex-1 truncate">{f?.name ?? "—"}</span>
                      </span>
                    )
                  })()}
                </ItemTitle>
                <ItemDescription className="min-w-0 max-w-full truncate font-mono text-xs">
                  {filePathLabel(f)}
                </ItemDescription>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {(() => {
                    const src = sourceBadgeSpec(f?.source)
                    if (!src) return null
                    const Icon = src.Icon
                    const isUrl = String(f?.source ?? "").toLowerCase() === "url"
                    const url = typeof f?.url === "string" && f.url ? f.url : null

                    const badge = (
                      <Badge variant="secondary" className="h-5 px-2 text-[11px]">
                        {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                        <span>{t(src.labelKey)}</span>
                      </Badge>
                    )

                    if (!isUrl || !url) return badge

                    return (
                      <Tooltip>
                        <TooltipTrigger asChild>{badge}</TooltipTrigger>
                        <TooltipContent side="top" sideOffset={6} className="max-w-[520px] break-all">
                          <div className="font-medium">{t("common.fileViewer.badges.originalUrl")}</div>
                          <div className="mt-1 font-mono">{url}</div>
                        </TooltipContent>
                      </Tooltip>
                    )
                  })()}
                  {(() => {
                    const st = statusBadgeSpec(f?.status)
                    const Icon = st.Icon
                    const isSpinning = String(f?.status ?? "").toLowerCase() === "fetching"
                    return (
                      <Badge variant="outline" className={cn("h-5 px-2 text-[11px]", st.className)}>
                        {Icon ? (
                          <Icon className={cn("h-3.5 w-3.5", isSpinning ? "animate-spin" : "")} aria-hidden="true" />
                        ) : null}
                        <span>{t(st.labelKey)}</span>
                      </Badge>
                    )
                  })()}
                </div>
                {String(f?.status ?? "").toLowerCase() === "failed" && f?.error ? (
                  <div className="mt-2 flex items-start gap-2 text-[12px] text-destructive">
                    <AlertCircle className="mt-[1px] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="break-words">{String(f.error)}</div>
                    </div>
                  </div>
                ) : null}
              </ItemContent>
              <ItemActions className="ml-auto shrink-0 self-start pt-0.5">
                {(() => {
                  const key = fileKey(f, idx)
                  const href = typeof f?.downloadHref === "string" && f.downloadHref ? f.downloadHref : null
                  const status = String(f?.status ?? "").toLowerCase()
                  const isFailed = status === "failed"
                  const isFetching = status === "fetching"
                  const isBusy = busyKeys.has(key)

                  // Show an explicit in-flight button for URL downloads (and any local "busy" actions),
                  // so users get immediate feedback without waiting for a full refresh.
                  if (isFetching || isBusy) {
                    return (
                      <Button size="sm" variant="secondary" disabled>
                        <Spinner className="size-4" aria-hidden="true" />
                        {t("common.fileViewer.actions.downloading")}
                      </Button>
                    )
                  }

                  if (!href) return null

                  const disabled = f?.downloadDisabled === true || isFetching || isFailed
                  return (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={disabled}
                      onClick={async () => {
                        setBusyKeys((prev) => new Set(prev).add(key))
                        try {
                          await handleDownloadClick(f)
                        } finally {
                          setBusyKeys((prev) => {
                            const next = new Set(prev)
                            next.delete(key)
                            return next
                          })
                        }
                      }}
                    >
                      <Download className="size-4" aria-hidden="true" />
                      {t("common.downloadAction")}
                    </Button>
                  )
                })()}
              </ItemActions>
            </Item>
            {idx < files.length - 1 ? <ItemSeparator /> : null}
          </React.Fragment>
        ))}
      </ItemGroup>
    )

  return (
    <ScrollAreaPrimitive.Root
      // No horizontal scrolling in the file viewer: long names/URLs should truncate instead.
      type="auto"
      className={cn("group relative flex h-full w-full flex-col overflow-hidden", props.className)}
    >
      <ScrollAreaPrimitive.Viewport
        className={cn(
          "h-full w-full min-w-0",
          // Radix ScrollArea wraps children in a `display: table` element to measure scroll size.
          // That wrapper can *still* expand layout width based on intrinsic content size (e.g. long URLs),
          // even when text is visually truncated. Force it to be a normal block that cannot widen the page.
          "[&>div]:!block [&>div]:!w-full [&>div]:!min-w-0 [&>div]:!max-w-full",
        )}
        style={{ overflowX: "hidden" }}
      >
        {content}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar orientation="vertical" />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
