"use client"

import { Plus } from "lucide-react"
import * as React from "react"
import { ArrowDownNarrowWide, ArrowUpNarrowWide } from "lucide-react"

import {
  useSchedulesPage,
  type ScheduleRow,
  type SchedulesSortKey,
} from "@/components/schedules/hooks/use-schedules-page"
import { StandardListPage } from "@/components/common/standard-list-page"
import { ListSortStatusFilters } from "@/components/common/list-sort-status-filters"
import type { ListFilterOption } from "@/components/common/list-sort-status-filters"
import { useI18n } from "@/components/i18n-provider"
import { EditScheduleSheet } from "@/components/schedules/sheets/edit-schedule-sheet"
import { NewScheduleSheet } from "@/components/schedules/sheets/new-schedule-sheet"
import { SchedulesCommonListItem } from "@/components/schedules/list/schedules-common-list-item"
import { SchedulesListPageSkeleton } from "@/components/schedules/list/schedules-list-page-skeleton"
import { HeaderActions } from "@/components/common/header-actions"
import { CommonListItemSkeleton } from "@/components/common/common-list-item-skeleton"
import { useLoadErrorAlert } from "@/hooks/use-load-error-alert"
import { useStableListRows } from "@/hooks/use-stable-list-rows"
import { useTopicStream } from "@/hooks/use-topic-stream"
import { makeListTopicForViewer } from "@/lib/shared/realtime/viewer-topics"
import { scheduleStatusUiSpec, toCanonicalScheduleStatus } from "@/lib/shared/schedule-status"
import { cn } from "@/lib/utils"
import { apiFetchJson } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"
import { tApiError } from "@/lib/shared/i18n/error"
import type { Viewer } from "@/lib/shared/viewer"

function toScheduleKind(v: string): "CRON" | "INTERVAL" {
  return v === "INTERVAL" ? "INTERVAL" : "CRON"
}

export default function SchedulesPage(props: { viewer: Viewer }) {
  const { t, locale } = useI18n()
  const [filtersOpen, setFiltersOpen] = React.useState("")
  const [editScheduleId, setEditScheduleId] = React.useState<string | null>(null)
  const [editOpen, setEditOpen] = React.useState(false)
  const [editScheduleDetail, setEditScheduleDetail] =
    React.useState<React.ComponentProps<typeof EditScheduleSheet>["schedule"]>(null)
  const searchInputRef = React.useRef<HTMLInputElement | null>(null)
  const {
    total,
    search,
    exactStatus,
    sort,
    loading,
    refreshing,
    loadError,
    pageSize,
    createOpen,
    exactStatusOptions,
    totalPages,
    safePageIndex,
    pageRows,
    statusLabel,
    setSearch,
    setExactStatus,
    setSort,
    setPageIndex,
    refresh,
    copyText,
    updateSchedule,
    runNow,
    onCreateOpenChange,
  } = useSchedulesPage()

  const loadErrorAlert = useLoadErrorAlert(loadError, [
    { key: "refresh", label: t("common.refreshAction"), onClick: () => void refresh() },
  ])
  const skeletonCount = Math.min(pageSize, 10)
  const { stableRowsRef, listItems } = useStableListRows({ rows: pageRows, loading, skeletonCount })
  const busy = loading || refreshing

  const refreshTmrRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    return () => {
      if (refreshTmrRef.current) window.clearTimeout(refreshTmrRef.current)
    }
  }, [])

  useTopicStream({
    topic: makeListTopicForViewer("schedules", props.viewer),
    enabled: true,
    onMessage: (msg) => {
      if (msg.type !== "schedule_state" && msg.type !== "schedule_deleted" && msg.type !== "job_state") return
      // Strategy B (SSE → debounce refetch):
      // - The Schedules list is more sensitive to filtering/sorting, so we prefer the "robust" path:
      //   treat SSE as a dirty signal, then refetch after coalescing events.
      // - Use a 250ms debounce to avoid triggering many requests under bursty updates.
      if (refreshTmrRef.current) window.clearTimeout(refreshTmrRef.current)
      refreshTmrRef.current = window.setTimeout(() => void refresh(), 250)
    },
  })

  const editSchedule = React.useMemo(() => {
    if (!editScheduleId) return null
    const all = loading ? stableRowsRef.current : pageRows
    return all.find((x) => x.publicId === editScheduleId) ?? null
  }, [editScheduleId, loading, pageRows, stableRowsRef])

  // When editing from the list page, fetch the full schedule detail for a complete editor model
  // (includes execution policies + inputJson).
  React.useEffect(() => {
    if (!editOpen || !editScheduleId) {
      setEditScheduleDetail(null)
      return
    }
    let cancelled = false
    setEditScheduleDetail(null)
    void (async () => {
      try {
        const j = await apiFetchJson<{
          schedule?: {
            id: string
            name: string | null
            enabled: boolean
            workflowId: string | null
            workflow: { id: string; publicId: string; name: string } | null
            kind: string
            cron: string | null
            timezone: string | null
            intervalMs: number | null
            misfirePolicy: string
            catchUpLimit: number | null
            overlapPolicy: string
            pinnedWorkflowVersion: { version: number } | null
            inputJson: unknown
            urlFiles?: Array<{ id?: string; url: string; name?: string }> | null
          }
        }>(`/api/schedules/${encodeURIComponent(editScheduleId)}`, { cache: "no-store" })
        if (cancelled) return
        const s = j.schedule
        if (!s) return
        setEditScheduleDetail({
          id: s.id,
          workflowId: s.workflow?.id ?? s.workflowId ?? null,
          workflowName: s.workflow?.name ?? null,
          name: s.name,
          enabled: Boolean(s.enabled),
          kind: toScheduleKind(String(s.kind).toUpperCase()),
          cron: s.cron,
          timezone: s.timezone,
          intervalMs: s.intervalMs,
          misfirePolicy: String(s.misfirePolicy ?? "FIRE_ONCE").toUpperCase() as "SKIP" | "FIRE_ONCE" | "CATCH_UP",
          catchUpLimit: s.catchUpLimit ?? null,
          overlapPolicy: String(s.overlapPolicy ?? "SKIP").toUpperCase() as "SKIP" | "ALLOW",
          pinnedWorkflowVersionNumber:
            typeof s.pinnedWorkflowVersion?.version === "number" ? s.pinnedWorkflowVersion.version : null,
          inputJson: s.inputJson ?? {},
          urlFiles: Array.isArray(s.urlFiles) ? s.urlFiles : [],
        })
      } catch (e) {
        if (cancelled) return
        toast.error(tApiError({ t, err: e, fallbackKey: "common.loadFailed" }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [editOpen, editScheduleId, t])

  const filtersActive = !!search.trim() || exactStatus !== "ANY" || sort !== "CREATED_DESC"

  function clearFilters() {
    setFiltersOpen("")
    setSearch("")
    setExactStatus("ANY")
    setSort("CREATED_DESC")
    setPageIndex(0)
  }

  const statusOpts: Array<ListFilterOption & { value: string }> = exactStatusOptions.map((s) => ({
    value: s,
    label: s === "ANY" ? t("common.any") : statusLabel(s),
    icon:
      s === "ANY"
        ? null
        : (() => {
            const canon = toCanonicalScheduleStatus(s)
            const ui = scheduleStatusUiSpec(canon)
            const Icon = ui.Icon
            return Icon ? (
              <Icon className={cn("size-4", ui.iconClassName, ui.varsClassName, ui.textClassName)} aria-hidden="true" />
            ) : null
          })(),
  }))
  const sortOpts: ReadonlyArray<ListFilterOption & { value: SchedulesSortKey }> = [
    {
      value: "CREATED_DESC",
      label: t("common.sortNewest"),
      icon: <ArrowDownNarrowWide className="text-muted-foreground" aria-hidden="true" />,
    },
    {
      value: "CREATED_ASC",
      label: t("common.sortOldest"),
      icon: <ArrowUpNarrowWide className="text-muted-foreground" aria-hidden="true" />,
    },
  ] as const

  const filters = (opts: { className?: string; disabled?: boolean }) => (
    <ListSortStatusFilters
      value={filtersOpen}
      onValueChange={setFiltersOpen}
      disabled={opts.disabled}
      className={opts.className}
      sort={sort}
      sortLabel={t("common.sort")}
      sortOptions={sortOpts}
      onSelectSort={setSort}
      status={exactStatus}
      statusLabel={t("common.status")}
      statusOptions={statusOpts}
      onSelectStatus={setExactStatus}
    />
  )

  const headerActions = [
    {
      key: "new",
      label: t("schedules.newSchedule"),
      icon: <Plus aria-hidden="true" />,
      onClick: () => onCreateOpenChange(true),
      pinned: true,
    },
  ] as const

  // ---- Hooks must stay above any conditional returns (Rules of Hooks). ----
  if (loading && pageRows.length === 0) {
    return <SchedulesListPageSkeleton rows={skeletonCount} />
  }

  return (
    <StandardListPage<ScheduleRow>
      alert={loadErrorAlert}
      modals={
        <>
          <NewScheduleSheet open={createOpen} onOpenChange={onCreateOpenChange} />
          <EditScheduleSheet
            open={editOpen}
            onOpenChange={(o) => {
              setEditOpen(o)
              if (!o) setEditScheduleId(null)
            }}
            schedule={editScheduleDetail}
            onSave={async (id, patch) => {
              await updateSchedule(
                id,
                {
                  name: typeof patch.name === "string" ? patch.name : (patch.name ?? null),
                  enabled: typeof patch.enabled === "boolean" ? patch.enabled : undefined,
                  kind: patch.kind,
                  cron: patch.cron ?? null,
                  timezone: patch.timezone ?? null,
                  intervalMs: typeof patch.intervalMs === "number" ? patch.intervalMs : (patch.intervalMs ?? null),
                  misfirePolicy:
                    typeof patch.misfirePolicy === "string"
                      ? (String(patch.misfirePolicy).toUpperCase() as "SKIP" | "FIRE_ONCE" | "CATCH_UP")
                      : undefined,
                  overlapPolicy:
                    typeof patch.overlapPolicy === "string"
                      ? (String(patch.overlapPolicy).toUpperCase() as "SKIP" | "ALLOW")
                      : undefined,
                  ...(patch.misfirePolicy === "CATCH_UP" && typeof patch.catchUpLimit === "number"
                    ? { catchUpLimit: Math.floor(patch.catchUpLimit) }
                    : {}),
                  ...(patch.pinnedWorkflowVersionNumber === null
                    ? { pinnedWorkflowVersionNumber: null }
                    : typeof patch.pinnedWorkflowVersionNumber === "number"
                      ? { pinnedWorkflowVersionNumber: Math.floor(patch.pinnedWorkflowVersionNumber) }
                      : {}),
                  inputJson:
                    typeof patch.inputJson === "string"
                      ? (() => {
                          try {
                            return patch.inputJson.trim() ? JSON.parse(patch.inputJson) : {}
                          } catch {
                            return undefined
                          }
                        })()
                      : undefined,
                },
                { successToastKey: "schedules.updatedToast", errorFallbackKey: "common.updateFailed" },
              )
            }}
          />
        </>
      }
      title={t("nav.schedules")}
      description={t("schedules.recentSchedulesDescription")}
      search={{
        value: search,
        placeholder: t("schedules.searchPlaceholder"),
        inputRef: searchInputRef,
        onChange: setSearch,
        onReset: () => {
          setSearch("")
          setPageIndex(0)
        },
        desktopRight: <HeaderActions sections={[{ key: "main", items: [...headerActions] }]} iconOnlyBelow="md" />,
      }}
      mobileBar={{
        left: (
          <div className="text-sm font-medium text-muted-foreground lg:hidden">
            {t("schedules.showingTotal", { total })}
          </div>
        ),
        right: <HeaderActions sections={[{ key: "main", items: [...headerActions] }]} iconOnlyBelow="md" />,
      }}
      listHeader={{
        left: (
          <div className="hidden lg:block text-sm font-medium text-muted-foreground">
            {t("schedules.showingTotal", { total })}
          </div>
        ),
        right: (
          <div className="w-full lg:w-auto">
            {filters({ className: "justify-start lg:justify-end", disabled: busy })}
          </div>
        ),
      }}
      emptyState={{
        loading,
        filtersActive,
        empty: t("schedules.emptyState"),
        noResultsTitle: t("schedules.noResultsTitle"),
        noResultsDescription: t("common.list.noResultsDescription"),
        clearFiltersLabel: t("common.filters.clearAction"),
        onClearFilters: clearFilters,
      }}
      list={{
        items: listItems,
        getRowKey: (it) => it.publicId,
        renderSkeleton: (idx) => <CommonListItemSkeleton key={`skwrap:${idx}`} />,
        renderRow: (it) => (
          <SchedulesCommonListItem
            key={it.publicId}
            locale={locale}
            model={{
              id: it.publicId,
              title: it.name?.trim() ? String(it.name) : it.workflowName,
              enabled: Boolean(it.enabled),
              workflowId: it.workflowId,
              lastJobId: it.lastJobId ?? null,
              lastRunId: it.lastRunId ?? null,
              createdAt: it.createdAt,
              kind: it.kind,
              cron: it.cron,
              timezone: it.timezone,
              intervalMs: it.intervalMs,
              nextRunAt: it.nextRunAt,
            }}
            href={`/schedules/${it.publicId}`}
            statusLabel={(enabled) => statusLabel(enabled ? "ENABLED" : "DISABLED")}
            actions={{
              copyId: () => copyText(it.publicId),
              toggleEnabled: (enabled) =>
                void updateSchedule(
                  it.publicId,
                  { enabled },
                  {
                    successToastKey: enabled ? "schedules.enabledToast" : "schedules.disabledToast",
                    errorFallbackKey: "common.updateFailed",
                  },
                ),
              runNow: () => void runNow(it.publicId),
              edit: () => {
                setEditScheduleId(it.publicId)
                setEditOpen(true)
              },
              copyLink: () => void copyText(`${window.location.origin}/schedules/${it.publicId}`),
            }}
          />
        ),
      }}
      pagination={{
        pageIndex: safePageIndex,
        totalPages,
        onPageIndexChange: setPageIndex,
        compactOnMobile: true,
        previousLabel: t("common.prevPageAction"),
        nextLabel: t("common.nextPageAction"),
      }}
    />
  )
}
