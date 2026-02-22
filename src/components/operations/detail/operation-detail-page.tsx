"use client"

import * as React from "react"
import { useParams } from "next/navigation"
import { Activity, Clock3, Hash, Layers, ListChecks, Play, User, WorkflowIcon } from "lucide-react"

import { CopyableIdBadge } from "@/components/common/copyable-id-badge"
import { HeaderSubbar } from "@/components/common/header-subbar"
import { useI18n } from "@/components/i18n-provider"
import { JsonViewer } from "@/components/common/json-viewer"
import { StandardPageHeader } from "@/components/common/standard-page-header"
import { LoadingState } from "@/components/common/loading-state"
import { apiFetchJson } from "@/lib/shared/http/api"
import { useTopicStream } from "@/hooks/use-topic-stream"
import { makeStreamTopic } from "@/lib/shared/realtime/topics"
import { monotonicMerge } from "@/lib/shared/realtime/monotonic"
import { isRecord } from "@/lib/shared/lang/is-record"
import { DetailPageLayout } from "@/components/common/detail-page-layout"
import { PageLoadError } from "@/components/common/page-load-error"
import { operationStatusUiSpec, toCanonicalOperationStatus } from "@/lib/shared/operation-status"
import { cn } from "@/lib/utils"
import { SectionCard, SectionCardBody, SectionCardHeader } from "@/components/common/section-card"
import { TwoLineMiniCard } from "@/components/common/two-line-mini-card"
import { formatAbsoluteTimeTitle, formatRelativeTimeFromNow } from "@/lib/shared/format/time"
import { StatusCollapsibleCard } from "@/components/common/status-collapsible-card"
import { KeyValueGrid } from "@/components/common/key-value-grid"
import type { ErrorEnvelope } from "@/lib/shared/error-display/types"
import { resolveDisplayError } from "@/lib/shared/error-display/resolve-display-error"
import { useTimezone } from "@/components/timezone-provider"

type OperationDetail = {
  id: string
  publicId: string
  publicNumber: number
  status: string
  action: string
  source: string | null
  scope: string | null
  targetType: string | null
  targetId: string | null
  audit: { actor: string | null; tenantId: string | null; requestId: string | null }
  progress: {
    current: number
    total: number | null
    messageKey: string | null
    messageParams: Record<string, string | number> | null
  }
  createdAt: string
  updatedAt: string
  completedAt: string | null
  result: { status: number; body: unknown; headers: unknown } | null
  error: ErrorEnvelope | null
}

type ExpandedOperationTarget = {
  type: string
  id: string
  displayId: string
  href: string
  status: string
  title: string | null
  error: ErrorEnvelope | null
  meta?: Record<string, unknown> | null
} | null

export default function OperationDetailPage() {
  const { t, locale } = useI18n()
  const { effectiveTimezone } = useTimezone()
  const params = useParams<{ operationId: string }>()
  const operationId = String(params?.operationId ?? "")

  const [op, setOp] = React.useState<OperationDetail | null>(null)
  const [target, setTarget] = React.useState<ExpandedOperationTarget>(null)
  const [err, setErr] = React.useState<unknown>(null)
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const j = await apiFetchJson<{ operation?: OperationDetail; target?: ExpandedOperationTarget }>(
        `/api/operations/${operationId}?expand=target`,
        {
          cache: "no-store",
        },
      )
      setOp(j.operation ?? null)
      setTarget((j.target ?? null) as ExpandedOperationTarget)
      setErr(null)
    } catch (e) {
      setErr(e)
    } finally {
      setLoading(false)
    }
  }, [operationId])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  useTopicStream({
    topic: operationId ? makeStreamTopic("operation", operationId) : null,
    enabled: !!operationId,
    onMessage: (msg) => {
      if (msg.type !== "operation_created" && msg.type !== "operation_progress" && msg.type !== "operation_completed")
        return
      // When the operation completes, re-fetch full detail so we can show structured error chains (errorJson-derived).
      if (msg.type === "operation_completed") {
        void refresh()
        return
      }
      const d = msg.data
      if (!isRecord(d)) return
      if (String(d.operationId ?? "") !== String(operationId)) return

      // Merge lightweight state updates into the existing detail payload.
      setOp((prev) => {
        if (!prev) return prev
        const patch: Partial<OperationDetail> & Record<string, unknown> = {}
        if (typeof d.status === "string") patch.status = d.status
        if (typeof d.action === "string") patch.action = d.action
        if (typeof d.source === "string" || d.source === null) patch.source = d.source
        if (typeof d.scope === "string" || d.scope === null) patch.scope = d.scope
        if (typeof d.targetType === "string" || d.targetType === null) patch.targetType = d.targetType
        if (typeof d.targetId === "string" || d.targetId === null) patch.targetId = d.targetId
        if (typeof d.updatedAt === "string") patch.updatedAt = d.updatedAt
        if (typeof d.completedAt === "string" || d.completedAt === null) patch.completedAt = d.completedAt
        if (
          typeof d.errorCode === "string" ||
          typeof d.errorMessage === "string" ||
          d.errorCode === null ||
          d.errorMessage === null
        ) {
          const code = typeof d.errorCode === "string" ? String(d.errorCode) : null
          const msg = typeof d.errorMessage === "string" ? String(d.errorMessage) : null
          const safeMsg = code && msg && msg.trim() === code.trim() ? null : msg
          patch.error =
            code || safeMsg
              ? ({
                  code: code ?? "UNKNOWN",
                  message: safeMsg ?? null,
                  layer: "operation",
                  meta: null,
                  causes: null,
                } as ErrorEnvelope)
              : null
        }

        patch.audit = {
          actor: typeof d.actor === "string" ? d.actor : null,
          tenantId: typeof d.tenantId === "string" ? d.tenantId : null,
          requestId: typeof d.requestId === "string" ? d.requestId : null,
        }
        patch.progress = {
          current: typeof d.progressCurrent === "number" ? d.progressCurrent : (prev.progress.current ?? 0),
          total: typeof d.progressTotal === "number" ? d.progressTotal : null,
          messageKey: typeof d.progressMessageKey === "string" ? d.progressMessageKey : null,
          messageParams:
            d.progressMessageParams &&
            typeof d.progressMessageParams === "object" &&
            !Array.isArray(d.progressMessageParams)
              ? (d.progressMessageParams as Record<string, string | number>)
              : null,
        }

        return monotonicMerge(prev, patch, {
          versionKey: "updatedAt",
          getStatus: (x) => (isRecord(x) ? String(x.status ?? "") : ""),
          terminalStatuses: ["SUCCEEDED", "FAILED"],
        })
      })
    },
  })

  const title = t("operations.title")
  const titleText = op?.action ? String(op.action) : title
  const statusUi = operationStatusUiSpec(op?.status ?? "")
  const canonicalStatus = toCanonicalOperationStatus(op?.status ?? "")
  const statusText = (() => {
    if (canonicalStatus === "SUCCEEDED") return t("common.statusValues.succeeded")
    if (canonicalStatus === "FAILED") return t("common.statusValues.failed")
    if (canonicalStatus === "RUNNING") return t("common.statusValues.running")
    if (canonicalStatus === "PENDING") return t("operations.statusPending")
    return canonicalStatus || "—"
  })()
  const responseStatus = typeof op?.result?.status === "number" ? op.result.status : null
  const progressMessage = (() => {
    const messageKey = typeof op?.progress?.messageKey === "string" ? op.progress.messageKey : null
    if (!messageKey) return null
    const params = op?.progress?.messageParams ?? undefined
    return t(messageKey, params ?? undefined)
  })()
  const progressText =
    op?.progress != null
      ? `${String(op.progress.current ?? 0)}${op.progress.total != null ? `/${String(op.progress.total)}` : ""}${
          progressMessage ? ` — ${String(progressMessage)}` : ""
        }`
      : "—"

  const opDisplayError = React.useMemo(() => resolveDisplayError(op?.error ?? null), [op?.error])
  const targetDisplayError = React.useMemo(() => resolveDisplayError(target?.error ?? null), [target?.error])
  const bestDisplayError = React.useMemo(() => {
    if (targetDisplayError?.display?.code) return targetDisplayError
    return opDisplayError
  }, [opDisplayError, targetDisplayError])
  const failedUi = React.useMemo(() => operationStatusUiSpec("FAILED"), [])

  const headerProps = {
    title: (
      <div className="flex min-w-0 items-center gap-2">
        {statusUi.Icon ? (
          <statusUi.Icon
            aria-hidden="true"
            className={cn("size-5 shrink-0", statusUi.iconClassName, statusUi.varsClassName, statusUi.textClassName)}
          />
        ) : null}
        <div className="min-w-0 truncate font-mono">{titleText}</div>
      </div>
    ),
    description: loading ? (
      <span className="text-muted-foreground">{t("common.loading")}</span>
    ) : op ? null : (
      <span className="text-muted-foreground">{t("common.notFound")}</span>
    ),
    bottom: (
      <HeaderSubbar hideAt="lg" className="flex-row items-center justify-between">
        <HeaderSubbar.Left>
          {op?.targetId ? (
            <CopyableIdBadge
              id={String(op.targetId)}
              Icon={(() => {
                const tt = String(op.targetType ?? "")
                if (tt === "run") return Play
                if (tt === "job") return ListChecks
                if (tt === "schedule") return Clock3
                if (tt === "workflow") return WorkflowIcon
                if (tt === "batch") return Layers
                return Activity
              })()}
            />
          ) : null}
          {op?.audit?.requestId ? <CopyableIdBadge id={String(op.audit.requestId)} label="req" Icon={Hash} /> : null}
        </HeaderSubbar.Left>
        {loading ? (
          <HeaderSubbar.Right>
            <div className="text-xs text-muted-foreground">{t("common.loading")}</div>
          </HeaderSubbar.Right>
        ) : null}
      </HeaderSubbar>
    ),
  } satisfies React.ComponentProps<typeof StandardPageHeader>

  // Main resource load failure: render a page-level error state (no top alert).
  if (err && !op && !loading) {
    return (
      <PageLoadError error={err} onRetry={() => void refresh()} backHref="/operations" backLabelKey="nav.operations" />
    )
  }

  // First paint: render a full-page skeleton (match Jobs/Runs/Schedules UX).
  if (loading && !op && !err) {
    return <LoadingState textKey="common.loading" spinner placement="top" minHeightClassName="min-h-[40vh]" />
  }

  return (
    <DetailPageLayout header={<StandardPageHeader {...headerProps} />}>
      {canonicalStatus === "FAILED" && bestDisplayError?.display?.code ? (
        <StatusCollapsibleCard
          icon={
            failedUi.Icon ? (
              <failedUi.Icon
                aria-hidden="true"
                className={cn("h-4 w-4", failedUi.iconClassName, failedUi.textClassName)}
              />
            ) : (
              <Activity aria-hidden="true" className={cn("h-4 w-4", failedUi.textClassName)} />
            )
          }
          leftIconClassName={cn("h-4 w-4 shrink-0", failedUi.varsClassName, failedUi.textClassName)}
          title={<span className="font-medium">{t("common.errorLabel")}</span>}
          summary={({ open }) =>
            open ? null : (
              <span className={cn("font-mono", failedUi.textClassName)}>{String(bestDisplayError.display.code)}</span>
            )
          }
          defaultOpen={false}
          toggleAriaLabel={(open) => (open ? t("common.hideAction") : t("common.showAction"))}
          className={cn("flex-none", failedUi.varsClassName, failedUi.containerClassName)}
          bodyClassName={cn("space-y-2", failedUi.borderClassName)}
        >
          <KeyValueGrid>
            <KeyValueGrid.Row label="DISPLAY_CODE" valueClassName={cn(failedUi.textClassName)}>
              {String(bestDisplayError.display.code)}
            </KeyValueGrid.Row>
            {bestDisplayError.wrapper?.code || bestDisplayError.wrapper?.message ? (
              <KeyValueGrid.Row label="WRAPPER">
                {String(bestDisplayError.wrapper.code ?? "—")}
                {bestDisplayError.wrapper.message && bestDisplayError.wrapper.message !== bestDisplayError.wrapper.code
                  ? `: ${String(bestDisplayError.wrapper.message)}`
                  : ""}
              </KeyValueGrid.Row>
            ) : null}
            {Array.isArray(bestDisplayError.chain) && bestDisplayError.chain.length ? (
              <KeyValueGrid.Row label="CHAIN">
                <div className="space-y-1">
                  {(() => {
                    const seen = new Set<string>()
                    const out: Array<{ code: string; message: string | null }> = []
                    for (const e of bestDisplayError.chain) {
                      const code = String(e.code ?? "")
                      if (!code) continue
                      if (seen.has(code)) continue
                      seen.add(code)
                      const msg = e.message ? String(e.message) : null
                      out.push({ code, message: msg && msg !== code ? msg : null })
                    }
                    return out.map((e, idx) => (
                      <div key={idx} className="font-mono text-xs text-muted-foreground">
                        {e.code}
                        {e.message ? `: ${e.message}` : ""}
                      </div>
                    ))
                  })()}
                </div>
              </KeyValueGrid.Row>
            ) : null}
          </KeyValueGrid>
        </StatusCollapsibleCard>
      ) : null}

      {target ? (
        <SectionCard className="flex-none text-card-foreground">
          <SectionCardHeader>
            <div className="text-sm font-medium">{t("operations.detail.target")}</div>
          </SectionCardHeader>
          <SectionCardBody className="p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <TwoLineMiniCard
                href={target.href}
                title={t("operations.detail.target")}
                value={String(target.displayId)}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("operations.detail.status")}
                value={String(target.status ?? "—")}
                valueClassName="font-mono text-sm"
              />
            </div>
          </SectionCardBody>
        </SectionCard>
      ) : null}

      {!loading && op ? (
        <SectionCard className="flex-none text-card-foreground">
          <SectionCardHeader>
            <div className="text-sm font-medium">{t("operations.detail.summary")}</div>
          </SectionCardHeader>
          <SectionCardBody className="p-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <TwoLineMiniCard
                title={t("operations.detail.status")}
                titleRight={
                  statusUi.Icon ? (
                    <statusUi.Icon className={cn("size-4", statusUi.iconClassName)} aria-hidden="true" />
                  ) : null
                }
                titleRightClassName={cn(statusUi.varsClassName, statusUi.textClassName)}
                value={statusText}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("operations.detail.action")}
                value={String(op.action ?? "—")}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("operations.detail.source")}
                value={op.source ? String(op.source) : "—"}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("operations.detail.target")}
                value={
                  op.targetId ? (
                    <span className="font-mono text-sm">{String(target?.displayId ?? op.targetId)}</span>
                  ) : (
                    "—"
                  )
                }
                truncate={true}
              />
              <TwoLineMiniCard
                title={t("operations.detail.responseStatus")}
                value={responseStatus != null ? `HTTP ${String(responseStatus)}` : "—"}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("common.fields.createdAt")}
                titleRight={<Clock3 className="size-4" aria-hidden="true" />}
                value={formatRelativeTimeFromNow(op.createdAt ?? null, { locale })}
                valueTitle={formatAbsoluteTimeTitle(op.createdAt ?? null, { locale, timeZone: effectiveTimezone })}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("common.fields.updatedAt")}
                titleRight={<Clock3 className="size-4" aria-hidden="true" />}
                value={formatRelativeTimeFromNow(op.updatedAt ?? null, { locale })}
                valueTitle={formatAbsoluteTimeTitle(op.updatedAt ?? null, { locale, timeZone: effectiveTimezone })}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("operations.detail.completedAt")}
                titleRight={<Clock3 className="size-4" aria-hidden="true" />}
                value={formatRelativeTimeFromNow(op.completedAt ?? null, { locale })}
                valueTitle={formatAbsoluteTimeTitle(op.completedAt ?? null, { locale, timeZone: effectiveTimezone })}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("operations.detail.scope")}
                value={op.scope ? String(op.scope) : "—"}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("operations.detail.actor")}
                titleRight={<User className="size-4" aria-hidden="true" />}
                value={op.audit?.actor ? String(op.audit.actor) : "—"}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("operations.detail.tenant")}
                value={op.audit?.tenantId ? String(op.audit.tenantId) : "—"}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("operations.detail.requestId")}
                value={op.audit?.requestId ? String(op.audit.requestId) : "—"}
                valueClassName="font-mono text-sm"
              />
              <TwoLineMiniCard
                title={t("operations.detail.progress")}
                value={progressText}
                valueClassName="font-mono text-sm"
                truncate={true}
              />
            </div>
          </SectionCardBody>
        </SectionCard>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard className="text-card-foreground">
          <SectionCardHeader>
            <div className="text-sm font-medium">{t("operations.detail.result")}</div>
          </SectionCardHeader>
          <SectionCardBody className="h-[360px]">
            <JsonViewer value={op?.result ?? null} />
          </SectionCardBody>
        </SectionCard>
        <SectionCard className="text-card-foreground">
          <SectionCardHeader>
            <div className="text-sm font-medium">{t("common.errorLabel")}</div>
          </SectionCardHeader>
          <SectionCardBody className="h-[360px]">
            <JsonViewer value={op?.error ?? null} />
          </SectionCardBody>
        </SectionCard>
        <SectionCard className="text-card-foreground">
          <SectionCardHeader>
            <div className="text-sm font-medium">{t("operations.detail.rootCause")}</div>
          </SectionCardHeader>
          <SectionCardBody className="h-[360px]">
            <JsonViewer value={bestDisplayError?.display ?? null} />
          </SectionCardBody>
        </SectionCard>
      </div>
    </DetailPageLayout>
  )
}
