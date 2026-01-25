import { RunStatus } from "@prisma/client"
import Link from "next/link"
import { AlertTriangle, Layers, PlayIcon, WorkflowIcon } from "lucide-react"

import { prisma } from "@/lib/server/db"
import type { Metadata } from "next"
import { getT } from "@/lib/server/i18n/server"
import { requireAuthedUser } from "@/lib/server/auth/require"
import { normalizeRole } from "@/lib/shared/viewer"
import { StandardPageHeader } from "@/components/common/standard-page-header"
import { SectionCard, SectionCardBody, SectionCardHeader } from "@/components/common/section-card"
import { TwoLineMiniCard } from "@/components/common/two-line-mini-card"
import { HomeTopbar } from "@/components/home/home-topbar"
import { HomeGettingStarted } from "@/components/home/home-getting-started"
import {
  HomeRunsRowList,
  HomeWorkflowRowList,
  type HomeRunRow,
  type HomeWorkflowRow as HomeWorkflowRowModel,
} from "@/components/home/home-dashboard-rows"
import { Button } from "@/components/ui/button"
import { listWorkflowTemplates } from "@/lib/server/templates"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("home.dashboardTitle"),
    description: t("home.description"),
  }
}

type WorkflowRow = {
  id: string
  publicId: string
  name: string
  description: string | null
  updatedAt: Date
}

export default async function Home() {
  const user = await requireAuthedUser()
  const admin = normalizeRole(user.role) === "ADMIN"
  const { t, locale } = await getT()
  const TAKE_WORKFLOWS = 6
  const TAKE_RECENT_RUNS = 6
  const TAKE_RUNNING_RUNS = 6
  const TAKE_FAILED = 6

  const workflowScope = admin ? {} : { ownerUserId: user.id }
  const runScope = admin ? {} : { triggeredByUserId: user.id }
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [workflows, recentRuns, runningRuns, recentFailedRuns, dashboardCounts] = await Promise.all([
    prisma.workflow.findMany({
      where: workflowScope,
      orderBy: [{ updatedAt: "desc" }],
      take: TAKE_WORKFLOWS,
      select: { id: true, publicId: true, name: true, description: true, updatedAt: true },
    }),
    prisma.run.findMany({
      where: runScope,
      orderBy: [{ createdAt: "desc" }],
      take: TAKE_RECENT_RUNS,
      select: {
        publicId: true,
        workflowName: true,
        status: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        failureCode: true,
        failureMessage: true,
        failureAt: true,
      },
    }),
    prisma.run.findMany({
      where: runScope ? { ...runScope, status: RunStatus.RUNNING } : { status: RunStatus.RUNNING },
      orderBy: [{ createdAt: "desc" }],
      take: TAKE_RUNNING_RUNS,
      select: { publicId: true, workflowName: true, status: true, createdAt: true, startedAt: true, finishedAt: true },
    }),
    prisma.run.findMany({
      where: runScope ? { ...runScope, status: RunStatus.FAILED } : { status: RunStatus.FAILED },
      orderBy: [{ failureAt: "desc" }, { createdAt: "desc" }],
      take: TAKE_FAILED,
      select: {
        publicId: true,
        workflowName: true,
        status: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
        failureCode: true,
        failureMessage: true,
        failureAt: true,
      },
    }),
    prisma.$transaction([
      prisma.workflow.count({ where: workflowScope }),
      prisma.run.count({ where: runScope }),
      prisma.run.count({ where: { ...runScope, status: RunStatus.RUNNING } }),
      prisma.run.count({ where: { ...runScope, status: RunStatus.SUCCEEDED, finishedAt: { gte: since24h } } }),
      prisma.run.count({ where: { ...runScope, status: RunStatus.FAILED, failureAt: { gte: since24h } } }),
    ]),
  ])

  const [workflowTotal, runTotal, runningTotal, succeeded24hTotal, failed24hTotal] = dashboardCounts

  const showGettingStarted = workflowTotal === 0
  const workflowTemplates = showGettingStarted ? shuffle(await listWorkflowTemplates(locale)) : []

  function shuffle<T>(arr: T[]): T[] {
    // Shuffle on the server so SSR + hydration stay consistent, but refresh changes the order.
    const copy = arr.slice()
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
  }

  const workflowIds = workflows.map((w) => w.id)
  const [stepCounts, runCounts, runningCounts] = workflowIds.length
    ? await prisma.$transaction([
        prisma.workflowStep.groupBy({
          by: ["workflowId"],
          where: { workflowId: { in: workflowIds } },
          orderBy: [{ workflowId: "asc" }],
          _count: { _all: true },
        }),
        prisma.run.groupBy({
          by: ["workflowId"],
          where: { workflowId: { in: workflowIds } },
          orderBy: [{ workflowId: "asc" }],
          _count: { _all: true },
        }),
        prisma.run.groupBy({
          by: ["workflowId"],
          where: { workflowId: { in: workflowIds }, status: "RUNNING" },
          orderBy: [{ workflowId: "asc" }],
          _count: { _all: true },
        }),
      ])
    : [[], [], []]

  const typedStepCounts = stepCounts as Array<{ workflowId: string; _count: { _all: number } }>
  const typedRunCounts = runCounts as Array<{ workflowId: string; _count: { _all: number } }>
  const typedRunningCounts = runningCounts as Array<{ workflowId: string; _count: { _all: number } }>

  const stepMap = new Map(typedStepCounts.map((r) => [r.workflowId, r._count._all]))
  const runMap = new Map(typedRunCounts.map((r) => [r.workflowId, r._count._all]))
  const runningMap = new Map(typedRunningCounts.map((r) => [r.workflowId, r._count._all]))

  const toIso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
  const runsToHome = (rows: Array<Record<string, unknown>>): HomeRunRow[] =>
    rows.map((r) => ({
      publicId: String(r.publicId),
      workflowName: String(r.workflowName),
      status: String(r.status),
      createdAt: toIso(r.createdAt as Date) ?? new Date().toISOString(),
      startedAt: toIso((r.startedAt as Date | null) ?? null),
      finishedAt: toIso((r.finishedAt as Date | null) ?? null),
      failureCode: (r.failureCode as string | null | undefined) ?? null,
      failureMessage: (r.failureMessage as string | null | undefined) ?? null,
      failureAt: toIso((r.failureAt as Date | null | undefined) ?? null),
      failureMetaJson: null,
    }))

  const recentRunsRows = runsToHome(recentRuns as unknown as Array<Record<string, unknown>>)
  const failedRunsRows = runsToHome(recentFailedRuns as unknown as Array<Record<string, unknown>>)
  const runningRunsRows = runsToHome(runningRuns as unknown as Array<Record<string, unknown>>)

  const workflowRows: HomeWorkflowRowModel[] = (workflows as WorkflowRow[]).map((w) => ({
    publicId: w.publicId,
    name: w.name,
    description: w.description ?? null,
    updatedAt: w.updatedAt.toISOString(),
    stepCount: stepMap.get(w.id) ?? 0,
    runCount: runMap.get(w.id) ?? 0,
    runningRunCount: runningMap.get(w.id) ?? 0,
  }))

  return (
    <div className="space-y-4">
      <StandardPageHeader title={t("home.dashboardTitle")} right={<HomeTopbar />} />

      {showGettingStarted ? (
        <>
          {/* Marker used by the i18n provider to decide whether to refresh on locale change. */}
          <div data-home-templates="1" className="hidden" aria-hidden="true" />
          <HomeGettingStarted templates={workflowTemplates} />
        </>
      ) : null}

      {showGettingStarted ? null : (
        <>
          {/* KPI / overview row */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TwoLineMiniCard
              href="/workflows"
              title={t("home.statsWorkflows")}
              titleRight={<WorkflowIcon className="size-4" aria-hidden="true" />}
              value={workflowTotal}
            />
            <TwoLineMiniCard
              href="/runs"
              title={t("home.statsRuns")}
              titleRight={<Layers className="size-4" aria-hidden="true" />}
              value={runTotal}
              valueRight={<span className="text-xs">{t("home.statsRunsHint")}</span>}
              truncate={false}
            />
            <TwoLineMiniCard
              href="/runs?status=RUNNING"
              title={t("home.statsRunning")}
              titleRight={<PlayIcon className="size-4" aria-hidden="true" />}
              value={runningTotal}
              valueRight={
                <span className="text-xs">
                  {succeeded24hTotal} {t("common.statusValues.succeeded")} (24h)
                </span>
              }
              truncate={false}
            />
            <TwoLineMiniCard
              href="/runs?status=FAILED"
              title={t("home.statsNeedsAttention")}
              titleRight={<AlertTriangle className="size-4" aria-hidden="true" />}
              value={failed24hTotal}
              valueRight={<span className="text-xs">{t("common.statusValues.failed")} (24h)</span>}
              truncate={false}
            />
          </div>

          {/* Needs attention */}
          <div className="grid gap-4 md:grid-cols-2 items-stretch">
            <SectionCard className="h-full">
              <SectionCardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{t("home.recentRunsTitle")}</div>
                    <div className="text-xs text-muted-foreground">{t("home.recentRunsDescription")}</div>
                  </div>
                  <Button asChild size="sm" variant="ghost" className="-mr-2">
                    <Link href="/runs">{t("home.viewAllRuns")}</Link>
                  </Button>
                </div>
              </SectionCardHeader>
              <SectionCardBody className="min-h-0">
                {recentRunsRows.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">{t("home.emptyRecentRuns")}</div>
                ) : (
                  <HomeRunsRowList locale={locale} rows={recentRunsRows} />
                )}
              </SectionCardBody>
            </SectionCard>

            <SectionCard className="h-full">
              <SectionCardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{t("home.recentFailuresTitle")}</div>
                    <div className="text-xs text-muted-foreground">{t("home.recentFailuresDescription")}</div>
                  </div>
                  <Button asChild size="sm" variant="ghost" className="-mr-2">
                    <Link href="/runs?status=FAILED">{t("home.viewFailedRuns")}</Link>
                  </Button>
                </div>
              </SectionCardHeader>
              <SectionCardBody className="min-h-0">
                {failedRunsRows.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">{t("home.emptyFailures")}</div>
                ) : (
                  <HomeRunsRowList locale={locale} rows={failedRunsRows} />
                )}
              </SectionCardBody>
            </SectionCard>
          </div>

          <div className="grid gap-4 md:grid-cols-2 items-stretch">
            <SectionCard className="h-full">
              <SectionCardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{t("home.activeRunsTitle")}</div>
                    <div className="text-xs text-muted-foreground">{t("home.activeRunsDescription")}</div>
                  </div>
                  <Button asChild size="sm" variant="ghost" className="-mr-2">
                    <Link href="/runs?status=RUNNING">{t("home.viewRunningRuns")}</Link>
                  </Button>
                </div>
              </SectionCardHeader>
              <SectionCardBody className="min-h-0">
                {runningRunsRows.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">{t("home.emptyActiveRuns")}</div>
                ) : (
                  <HomeRunsRowList locale={locale} rows={runningRunsRows} />
                )}
              </SectionCardBody>
            </SectionCard>

            <SectionCard className="h-full">
              <SectionCardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{t("home.recentWorkflowsTitle")}</div>
                    <div className="text-xs text-muted-foreground">{t("home.recentWorkflowsDescription")}</div>
                  </div>
                  <Button asChild size="sm" variant="ghost" className="-mr-2">
                    <Link href="/workflows">{t("home.viewAllWorkflows")}</Link>
                  </Button>
                </div>
              </SectionCardHeader>
              <SectionCardBody className="min-h-0">
                {workflowRows.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">{t("home.emptyWorkflows")}</div>
                ) : (
                  <HomeWorkflowRowList locale={locale} rows={workflowRows} />
                )}
              </SectionCardBody>
            </SectionCard>
          </div>
        </>
      )}
    </div>
  )
}
