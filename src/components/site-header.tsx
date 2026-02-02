"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { useI18n } from "@/components/i18n-provider"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { formatPublicIdForDisplay, formatShortId, looksLikePublicId } from "@/lib/shared/format/id"
import { apiFetchJson } from "@/lib/shared/http/api"
import { cn } from "@/lib/utils"

function titleCase(s: string) {
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
}

function SmartShortenWhenOverflow(props: {
  text: string
  head?: number
  tail?: number
  minLength?: number
  className?: string
}) {
  const { text, head = 12, tail = 12, minLength = 32, className } = props
  const wrapRef = React.useRef<HTMLSpanElement | null>(null)
  const measureRef = React.useRef<HTMLSpanElement | null>(null)
  const [overflowing, setOverflowing] = React.useState(false)

  React.useLayoutEffect(() => {
    const wrap = wrapRef.current
    const measure = measureRef.current
    if (!wrap || !measure) return
    if (typeof ResizeObserver === "undefined") return

    const compute = () => {
      // Compare full-text width vs available width.
      const next = measure.scrollWidth > wrap.clientWidth
      setOverflowing(next)
    }

    compute()

    const ro = new ResizeObserver(() => compute())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [text])

  const shouldShorten = overflowing && text.length > minLength
  const shown = shouldShorten ? formatShortId(text, { head, tail, minLength }) : text

  return (
    <span
      ref={wrapRef}
      className={cn("relative min-w-0 max-w-full overflow-hidden whitespace-nowrap", className)}
      title={text}
    >
      {/* Hidden full-text measurer; stays full even when we show shortened text. */}
      <span
        ref={measureRef}
        className="pointer-events-none absolute left-0 top-0 opacity-0 whitespace-nowrap"
        aria-hidden="true"
      >
        {text}
      </span>
      {shown}
    </span>
  )
}

const ROOT_SEGMENT_I18N_KEYS = {
  workflows: "nav.workflows",
  agent: "nav.agent",
  runs: "nav.runs",
  jobs: "nav.jobs",
  schedules: "nav.schedules",
  batches: "nav.batches",
  operations: "nav.operations",
  preference: "sidebar.preferences",
  admin: "sidebar.admin",
} as const

export function SiteHeader() {
  const { t } = useI18n()
  const pathname = usePathname()
  const parts = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean)
  const [resolved, setResolved] = React.useState<Record<string, string>>({})

  // Resolve /workflows/:id -> workflow.name, /runs/:id -> run.workflowName
  React.useEffect(() => {
    const prefix = parts[0]
    const id = parts[1]
    if (!prefix || !id) return
    // UUID-ish
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return

    const key = `${prefix}:${id}`
    if (resolved[key]) return

    const ac = new AbortController()
    const run = async () => {
      try {
        if (prefix === "workflows") {
          const j = await apiFetchJson<{ workflow?: { name?: string } }>(`/api/workflows/${id}`, {
            signal: ac.signal,
            cache: "no-store",
          })
          const name = j.workflow?.name
          if (name) setResolved((prev) => ({ ...prev, [key]: name }))
        }
        if (prefix === "runs") {
          const j = await apiFetchJson<{ run?: { workflowName?: string } }>(`/api/runs/${id}`, {
            signal: ac.signal,
            cache: "no-store",
          })
          const name = j.run?.workflowName
          if (name) setResolved((prev) => ({ ...prev, [key]: name }))
        }
        if (prefix === "operations") {
          const j = await apiFetchJson<{ operation?: { action?: string; targetId?: string | null } }>(
            `/api/operations/${id}`,
            { signal: ac.signal, cache: "no-store" },
          )
          const action = j.operation?.action
          const targetId = j.operation?.targetId
          const label = action ? (targetId ? `${action} (${targetId})` : action) : null
          if (label) setResolved((prev) => ({ ...prev, [key]: label }))
        }
      } catch {
        // ignore
      }
    }
    void run()
    return () => ac.abort()
  }, [parts.join("/")])

  // Basic breadcrumbs:
  // /workflows -> Workflows
  // /workflows/:id -> Workflows / :id (trimmed)
  const root = parts[0] ?? ""
  const knownLabelFor = (segment: string, idx: number) => {
    if (idx === 0) {
      const labelKey = ROOT_SEGMENT_I18N_KEYS[segment as keyof typeof ROOT_SEGMENT_I18N_KEYS]
      return labelKey ? t(labelKey) : undefined
    }

    if (root === "runs" && segment === "new") return t("runs.newRun")
    if (root === "workflows" && segment === "new") return t("workflows.newWorkflow")
    if (root === "workflows" && segment === "versions") return t("workflows.versions.title")
    if (root === "workflows" && segment === "agent") return t("nav.agent")
    if (root === "preference" && segment === "agent") return t("settings.agent.title")
    if (root === "preference" && segment === "notifications") return t("settings.notifications.title")
    if (root === "preference" && segment === "system") return t("settings.system.title")
    if (root === "preference" && segment === "general") return t("settings.general.title")
    if (root === "preference" && segment === "registration") return t("settings.system.general.sectionTitle")
    if (root === "preference" && segment === "email") return t("settings.system.email.sectionTitle")
    if (root === "preference" && segment === "advanced") return t("settings.system.performance.sectionTitle")
    if (root === "preference" && segment === "performance") return t("settings.system.performance.sectionTitle")
    if (root === "preference" && segment === "ops") return t("settings.system.ops.sectionTitle")
    if (root === "preference" && segment === "retention") return t("settings.system.ops.sectionTitle")
    if (root === "preference" && segment === "security") return t("settings.system.ops.sectionTitle")
    if (root === "admin" && segment === "users") return t("nav.adminUsers")
    return undefined
  }

  const formatFallbackLabel = (segment: string) => {
    if (looksLikePublicId(segment)) return formatPublicIdForDisplay(segment)
    return segment.length > 20 ? formatShortId(segment, { head: 8, tail: 6, minLength: 20 }) : titleCase(segment)
  }

  const crumbs = parts.map((segment, idx) => {
    const href = "/" + parts.slice(0, idx + 1).join("/")
    const isLast = idx === parts.length - 1
    const resolvedKey = idx === 1 && root ? `${root}:${segment}` : null
    const resolvedLabel = resolvedKey ? resolved[resolvedKey] : undefined
    const label = resolvedLabel ?? knownLabelFor(segment, idx) ?? formatFallbackLabel(segment)
    return { href, label, isLast }
  })

  const resolvedKeyForSecond = root && parts[1] ? `${root}:${parts[1]}` : null

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex min-w-0 items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
        <Breadcrumb>
          <BreadcrumbList className="min-w-0 flex-nowrap overflow-hidden whitespace-nowrap">
            {crumbs.length === 0 ? (
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage>{t("nav.home")}</BreadcrumbPage>
              </BreadcrumbItem>
            ) : (
              crumbs.map((c, idx) => (
                <React.Fragment key={c.href}>
                  <BreadcrumbItem
                    className={idx === crumbs.length - 1 ? "min-w-0 md:block" : "hidden min-w-0 md:block"}
                  >
                    {c.isLast ? (
                      <BreadcrumbPage className="max-w-[60vw] truncate">{c.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link href={c.href} className="inline-flex min-w-0 max-w-[45vw]">
                          {idx === 1 && resolvedKeyForSecond && resolved[resolvedKeyForSecond] ? (
                            <SmartShortenWhenOverflow text={c.label} head={12} tail={12} minLength={50} />
                          ) : (
                            <span className="inline-block max-w-full truncate align-bottom whitespace-nowrap">
                              {c.label}
                            </span>
                          )}
                        </Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {idx < crumbs.length - 1 ? <BreadcrumbSeparator className="hidden md:block" /> : null}
                </React.Fragment>
              ))
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
    </header>
  )
}
