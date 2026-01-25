import type React from "react"
import { redirect } from "next/navigation"
import { CheckCircle2, CircleSlash, Clock, GitBranch, Inbox, SkipForward, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { jobStatusUiSpec } from "@/lib/shared/job-status"
import { batchStatusUiSpec, toCanonicalBatchStatus } from "@/lib/shared/batch-status"
import { scheduleStatusUiSpec } from "@/lib/shared/schedule-status"
import { runStatusUiSpec, toCanonicalRunStatus } from "@/lib/shared/run-status"
import { cn } from "@/lib/utils"
import { requireAuthedUser } from "@/lib/server/auth/require"
import { normalizeRole } from "@/lib/shared/viewer"

function previewBadge(props: {
  label: string
  className: string
  Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  iconClassName?: string
  title?: string
}) {
  return (
    <Badge variant="outline" className={props.className} title={props.title}>
      <span className="inline-flex items-center gap-1.5">
        <props.Icon className={["h-3.5 w-3.5", props.iconClassName].filter(Boolean).join(" ")} aria-hidden={true} />
        <span className="font-mono text-[11px]">{props.label}</span>
      </span>
    </Badge>
  )
}

function badgeClassFor(status: string) {
  const s = toCanonicalRunStatus(status)
  const base = "maia-status-badge"
  if (s === "FAILED") return `${base} maia-status-badge--failed`
  if (s === "SUCCEEDED") return `${base} maia-status-badge--succeeded`
  if (s === "RUNNING") return `${base} maia-status-badge--running`
  if (s === "BLOCKED") return `${base} maia-status-badge--blocked`
  if (s === "PENDING" || s === "PENDING_INPUTS" || s === "INTERRUPTED") return `${base} maia-status-badge--pending`
  if (s === "CANCELED" || s === "SKIPPED") return `${base} maia-status-badge--canceled`
  return `${base} maia-status-badge--unknown`
}

function jobBadge(status: string) {
  const s = String(status || "").toUpperCase()
  const clsBase = "maia-status-badge"
  const ui = jobStatusUiSpec(s)
  const cls = `${clsBase} ${ui.varsClassName}`
  const Icon = ui.Icon ?? Clock
  return previewBadge({
    label: s || "—",
    className: cls,
    Icon,
    iconClassName: [ui.iconClassName, ui.textClassName].filter(Boolean).join(" "),
  })
}

function batchBadge(status: string) {
  const s = toCanonicalBatchStatus(String(status || ""))
  const ui = batchStatusUiSpec(s)
  const cls = `maia-status-badge ${ui.varsClassName}`
  const Icon = ui.Icon ?? Clock
  return previewBadge({
    label: s || "—",
    className: cls,
    Icon,
    iconClassName: [ui.iconClassName, ui.textClassName].filter(Boolean).join(" "),
  })
}

function scheduleBadge(enabled: boolean) {
  const ui = scheduleStatusUiSpec(enabled ? "ENABLED" : "DISABLED")
  const cls = `maia-status-badge ${ui.varsClassName}`
  const Icon = ui.Icon ?? CircleSlash
  return previewBadge({
    label: enabled ? "ENABLED" : "DISABLED",
    className: cls,
    Icon,
    iconClassName: cn(ui.iconClassName, ui.textClassName),
  })
}

function runBadge(status: string) {
  const s = toCanonicalRunStatus(status)
  const spec = runStatusUiSpec(s)
  return previewBadge({
    label: s || "—",
    className: `maia-status-badge ${spec.varsClassName}`,
    Icon: spec.Icon ?? Clock,
    iconClassName: cn(spec.iconClassName, spec.textClassName),
  })
}

export default async function Page() {
  const user = await requireAuthedUser()
  if (normalizeRole(user.role) !== "ADMIN") redirect("/preference")

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Status palette</CardTitle>
          <div className="text-xs text-muted-foreground">
            Internal UI reference for validating status semantics + colors (light/dark).
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Workflow deps</div>
              <div className="flex flex-wrap gap-2">
                {previewBadge({
                  label: "IDLE",
                  className: "maia-status-badge maia-status-badge--needs-action",
                  Icon: Clock,
                })}
                {previewBadge({
                  label: "INSTALLING",
                  className: "maia-status-badge maia-status-badge--running",
                  Icon: Spinner,
                })}
                {previewBadge({
                  label: "READY",
                  className: "maia-status-badge maia-status-badge--succeeded",
                  Icon: CheckCircle2,
                })}
                {previewBadge({
                  label: "FAILED",
                  className: "maia-status-badge maia-status-badge--failed",
                  Icon: XCircle,
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Schedule</div>
              <div className="flex flex-wrap gap-2">
                {scheduleBadge(true)}
                {scheduleBadge(false)}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Job</div>
              <div className="flex flex-wrap gap-2">
                {jobBadge("QUEUED")}
                {jobBadge("PAUSED")}
                {jobBadge("RUNNING")}
                {jobBadge("SUCCEEDED")}
                {jobBadge("FAILED")}
                {jobBadge("CANCELED")}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Batch</div>
              <div className="flex flex-wrap gap-2">
                {batchBadge("CREATED")}
                {batchBadge("PAUSED")}
                {batchBadge("RUNNING")}
                {batchBadge("SUCCEEDED")}
                {batchBadge("FAILED")}
                {batchBadge("CANCELED")}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Run</div>
              <div className="flex flex-wrap gap-2">
                {runBadge("PENDING_INPUTS")}
                {runBadge("RUNNING")}
                {runBadge("SUCCEEDED")}
                {runBadge("FAILED")}
                {runBadge("CANCELED")}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Step (DAG)</div>
              <div className="flex flex-wrap gap-2">
                {previewBadge({
                  label: "PENDING",
                  className: badgeClassFor("PENDING"),
                  Icon: Clock,
                  title: "Waiting for a worker slot",
                })}
                {previewBadge({
                  label: "BLOCKED",
                  className: badgeClassFor("BLOCKED"),
                  Icon: GitBranch,
                  title: "Waiting for upstream dependencies",
                })}
                {previewBadge({
                  label: "RUNNING",
                  className: badgeClassFor("RUNNING"),
                  Icon: Spinner,
                })}
                {previewBadge({
                  label: "SUCCEEDED",
                  className: badgeClassFor("SUCCEEDED"),
                  Icon: CheckCircle2,
                })}
                {previewBadge({
                  label: "FAILED",
                  className: badgeClassFor("FAILED"),
                  Icon: XCircle,
                })}
                {previewBadge({
                  label: "CANCELED",
                  className: badgeClassFor("CANCELED"),
                  Icon: XCircle,
                })}
                {previewBadge({
                  label: "SKIPPED",
                  className: badgeClassFor("SKIPPED"),
                  Icon: SkipForward,
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Attempt</div>
              <div className="flex flex-wrap gap-2">
                {previewBadge({
                  label: "RUNNING",
                  className: badgeClassFor("RUNNING"),
                  Icon: Spinner,
                })}
                {previewBadge({
                  label: "SUCCEEDED",
                  className: badgeClassFor("SUCCEEDED"),
                  Icon: CheckCircle2,
                })}
                {previewBadge({
                  label: "FAILED",
                  className: badgeClassFor("FAILED"),
                  Icon: XCircle,
                })}
                {previewBadge({
                  label: "CANCELED",
                  className: badgeClassFor("CANCELED"),
                  Icon: XCircle,
                })}
                {previewBadge({
                  label: "INTERRUPTED",
                  className: badgeClassFor("INTERRUPTED"),
                  Icon: Inbox,
                  title: "Interrupted by engine restart",
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
