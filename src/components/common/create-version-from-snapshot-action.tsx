"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { StandardConfirmDialog } from "@/components/common/standard-confirm-dialog"
import { useI18n } from "@/components/i18n-provider"
import { toast } from "@/lib/client/toast"
import { apiFetchJson } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"

type RestoreVersionResponse = {
  createdVersion?: { version?: number } | null
}

export function CreateVersionFromSnapshotAction(props: {
  workflowId?: string | null
  snapshotVersion?: number | null
  navigateMode?: "push" | "replace"
  onCreatedVersion?: (createdVersion: number | null) => void
  children: (args: {
    open: () => void
    openWith: (snapshotVersion: number) => void
    pending: boolean
    disabled: boolean
  }) => React.ReactNode
}) {
  const { t } = useI18n()
  const router = useRouter()

  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [snapshotVersionOverride, setSnapshotVersionOverride] = React.useState<number | null>(null)

  const workflowId = props.workflowId ?? null
  const snapshotVersion = snapshotVersionOverride ?? props.snapshotVersion ?? null
  const disabled = !workflowId || typeof snapshotVersion !== "number"
  const navigateMode = props.navigateMode ?? "push"

  async function onConfirm() {
    if (!workflowId || typeof snapshotVersion !== "number") return
    setPending(true)
    try {
      const res = await apiFetchJson<RestoreVersionResponse>(
        `/api/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(String(snapshotVersion))}/restore`,
        { method: "POST" },
      )
      const createdV = typeof res?.createdVersion?.version === "number" ? (res.createdVersion.version as number) : null
      toast.success(
        t("common.createActionVersionFromSnapshotToast", { version: createdV != null ? `v${String(createdV)}` : "" }),
      )
      setOpen(false)

      props.onCreatedVersion?.(createdV)
      if (!props.onCreatedVersion) {
        const to =
          createdV != null
            ? `/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(String(createdV))}`
            : `/workflows/${encodeURIComponent(workflowId)}/versions`
        if (navigateMode === "replace") router.replace(to)
        else router.push(to)
      }
    } catch (e) {
      toast.error(tApiError({ t, err: e, fallbackKey: "common.createActionVersionFromSnapshotFailed" }))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      {props.children({
        open: () => {
          setSnapshotVersionOverride(null)
          setOpen(true)
        },
        openWith: (v) => {
          setSnapshotVersionOverride(v)
          setOpen(true)
        },
        pending,
        disabled,
      })}

      <StandardConfirmDialog
        open={open}
        onOpenChange={(o) => {
          if (!o && pending) return
          setOpen(o)
        }}
        pending={pending}
        title={t("common.createActionVersionFromSnapshotTitle")}
        description={t("common.createActionVersionFromSnapshotDescription")}
        confirmText={t("common.createActionVersionFromSnapshotAction")}
        confirmVariant="destructive"
        onConfirm={onConfirm}
      />
    </>
  )
}
