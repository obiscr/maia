"use client"

import * as React from "react"
import { Calendar, ListTree, Play, WorkflowIcon } from "lucide-react"

import { RunsCommonListItem } from "@/components/runs/list/runs-common-list-item"
import { CommonListItem } from "@/components/common/common-list-item"
import { CopyableIdBadge } from "@/components/common/copyable-id-badge"
import { InlineItemRow, type InlineItemRowItem } from "@/components/common/inline-item-row"
import { ItemContent, ItemDescription, ItemTitle, ItemGroup, ItemSeparator } from "@/components/ui/item"
import type { Locale } from "@/lib/shared/i18n/constants"
import { formatRelativeTimeFromNow, formatDurationMs } from "@/lib/shared/format/time"
import { toCanonicalRunStatus } from "@/lib/shared/run-status"
import { useI18n } from "@/components/i18n-provider"
import { Spinner } from "@/components/ui/spinner"

export type HomeRunRow = {
  publicId: string
  workflowName: string
  status: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  failureCode?: string | null
  failureMessage?: string | null
  failureMetaJson?: string | null
  failureAt?: string | null
}

export function HomeRunsRowList(props: { locale: Locale; rows: HomeRunRow[] }) {
  const { t } = useI18n()

  function statusLabel(status: string) {
    const s = toCanonicalRunStatus(status)
    if (s === "SUCCEEDED") return t("common.statusValues.succeeded")
    if (s === "FAILED") return t("common.statusValues.failed")
    if (s === "RUNNING") return t("common.statusValues.running")
    if (s === "PENDING_INPUTS") return t("common.statusValues.queuedInputs")
    if (s === "CANCELED") return t("common.statusValues.canceled")
    return s || "—"
  }

  return (
    <ItemGroup>
      {props.rows.map((r, idx) => (
        <React.Fragment key={r.publicId}>
          <RunsCommonListItem
            locale={props.locale}
            model={{
              id: r.publicId,
              title: r.workflowName,
              status: r.status,
              failureCode: r.failureCode ?? null,
              failureMessage: r.failureMessage ?? null,
              failureMetaJson: r.failureMetaJson ?? null,
              failureAt: r.failureAt ?? null,
              createdAt: r.createdAt,
              startedAt: r.startedAt,
              finishedAt: r.finishedAt,
            }}
            href={`/runs/${r.publicId}`}
            formatDurationMs={formatDurationMs}
            statusLabel={statusLabel}
          />
          {idx < props.rows.length - 1 ? <ItemSeparator /> : null}
        </React.Fragment>
      ))}
    </ItemGroup>
  )
}

export type HomeWorkflowRow = {
  publicId: string
  name: string
  description: string | null
  updatedAt: string
  stepCount: number
  runCount: number
  runningRunCount: number
}

function HomeWorkflowListItem(props: { locale: Locale; model: HomeWorkflowRow }) {
  const { t } = useI18n()
  const w = props.model
  const updatedRel = formatRelativeTimeFromNow(w.updatedAt, { locale: props.locale })

  const countItems: InlineItemRowItem[] = [
    { key: "steps", title: t("common.steps"), Icon: ListTree, text: w.stepCount },
    { key: "runs", title: t("workflows.runs"), Icon: Play, text: w.runCount },
    {
      key: "running",
      title: t("workflows.running"),
      Icon: Spinner,
      iconClassName: "opacity-70",
      text: w.runningRunCount,
    },
    { key: "updated", title: t("workflows.updatedAt"), Icon: Calendar, text: updatedRel },
  ]

  return (
    <CommonListItem
      href={`/workflows/${w.publicId}`}
      columns={[
        {
          key: "left",
          showOnMobile: true,
          content: (
            <ItemContent className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0">
                  <WorkflowIcon aria-hidden="true" className="size-4.5 shrink-0 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <ItemTitle className="w-full min-w-0 text-base leading-snug">
                    <span className="block truncate">{w.name}</span>
                  </ItemTitle>
                </div>
              </div>

              <ItemDescription className="mt-1 pl-7 line-clamp-1">
                <span className="inline-flex flex-wrap items-center gap-2">
                  <CopyableIdBadge id={w.publicId} Icon={WorkflowIcon} />
                  {w.description ? <span className="min-w-0">{w.description}</span> : null}
                </span>
              </ItemDescription>

              <InlineItemRow
                className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-xs text-muted-foreground"
                items={countItems}
              />
            </ItemContent>
          ),
        },
      ]}
    />
  )
}

export function HomeWorkflowRowList(props: { locale: Locale; rows: HomeWorkflowRow[] }) {
  return (
    <ItemGroup>
      {props.rows.map((w, idx) => (
        <React.Fragment key={w.publicId}>
          <HomeWorkflowListItem locale={props.locale} model={w} />
          {idx < props.rows.length - 1 ? <ItemSeparator /> : null}
        </React.Fragment>
      ))}
    </ItemGroup>
  )
}
