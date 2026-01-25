"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { toast } from "@/lib/client/toast"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"

export type WorkflowVersionRow = { version: number; createdAt: string; description: string | null }

export function useWorkflowVersionPicker(params: {
  t: (key: string, vars?: Record<string, any>) => string
  workflowId: string
  enabled?: boolean
}) {
  const { t } = params
  const workflowId = String(params.workflowId ?? "").trim()
  const enabled = params.enabled !== false

  const [versions, setVersions] = useState<WorkflowVersionRow[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)

  const [metaLoading, setMetaLoading] = useState(false)
  const [latestVersionNumber, setLatestVersionNumber] = useState<number | null>(null)
  const [hasUnpublishedChanges, setHasUnpublishedChanges] = useState<boolean>(false)

  const reload = useCallback(async () => {
    if (!enabled || !workflowId) return

    setVersionsLoading(true)
    setMetaLoading(true)
    try {
      const [vj, mj] = await Promise.all([
        apiFetchJson<{ versions?: WorkflowVersionRow[] }>(
          `/api/workflows/${encodeURIComponent(workflowId)}/versions?pageSize=50&sort=CREATED_DESC`,
          { cache: "no-store" },
        ),
        apiFetchJson<{ workflow?: { latestVersionNumber?: number | null; hasUnpublishedChanges?: boolean } }>(
          `/api/workflows/${encodeURIComponent(workflowId)}/meta`,
          { cache: "no-store" },
        ),
      ])

      const rows = Array.isArray(vj?.versions) ? vj.versions : []
      setVersions(
        rows
          .filter((v): v is WorkflowVersionRow => typeof v?.version === "number" && Number.isFinite(v.version))
          .map((v) => ({
            version: Math.floor(v.version),
            createdAt: String(v.createdAt ?? ""),
            description: v.description ?? null,
          })),
      )

      const lv =
        typeof mj?.workflow?.latestVersionNumber === "number" && Number.isFinite(mj.workflow.latestVersionNumber)
          ? Math.floor(mj.workflow.latestVersionNumber)
          : null
      setLatestVersionNumber(lv)
      setHasUnpublishedChanges(Boolean(mj?.workflow?.hasUnpublishedChanges))
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.loadFailed" }))
      setVersions([])
      setLatestVersionNumber(null)
      setHasUnpublishedChanges(false)
    } finally {
      setVersionsLoading(false)
      setMetaLoading(false)
    }
  }, [enabled, t, workflowId])

  useEffect(() => {
    let cancelled = false
    if (!enabled || !workflowId) {
      setVersions([])
      setLatestVersionNumber(null)
      setHasUnpublishedChanges(false)
      setVersionsLoading(false)
      setMetaLoading(false)
      return
    }
    ;(async () => {
      await reload()
    })().catch(() => {})
    return () => {
      cancelled = true
      void cancelled
    }
  }, [enabled, reload, workflowId])

  const latestFromList = useMemo(() => {
    const vs = versions.map((v) => v.version).filter((n) => Number.isFinite(n))
    return vs.length ? Math.max(...vs) : null
  }, [versions])
  const effectiveLatestVersionNumber = latestVersionNumber ?? latestFromList

  const createVersionFromDraft = useCallback(async () => {
    if (!workflowId) throw new Error("workflowId required")
    const j = await apiFetchJson<{ version?: { version?: number } }>(
      `/api/workflows/${encodeURIComponent(workflowId)}/versions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    )
    const v = j?.version?.version
    const ver = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : null
    if (!ver) throw new Error("Invalid version response")
    // Refresh meta/versions after creating.
    void reload()
    return ver
  }, [reload, workflowId])

  return {
    versions,
    versionsLoading,
    metaLoading,
    latestVersionNumber: effectiveLatestVersionNumber,
    hasUnpublishedChanges,
    reload,
    createVersionFromDraft,
  }
}
