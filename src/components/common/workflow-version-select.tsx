"use client"

import { useMemo, useState } from "react"
import { Tag } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useWorkflowVersionPicker } from "@/components/common/use-workflow-version-picker"
import { FieldLabelWithHelp } from "@/components/common/field-label-with-help"

type SelectValue = "__latest" | `v:${number}`
type SelectOptionValue = "__latest" | "__draft" | `v:${number}`

export function WorkflowVersionSelect(props: {
  t: (key: string, vars?: Record<string, any>) => string
  workflowId: string
  value: number | null
  onChange: (next: number | null) => void
  disabled?: boolean
  allowDraft?: boolean
  labelTooltip?: string
}) {
  const { t } = props
  const workflowId = String(props.workflowId ?? "").trim()
  const disabled = Boolean(props.disabled)
  const allowDraft = props.allowDraft !== false

  const [creatingDraft, setCreatingDraft] = useState(false)

  const picker = useWorkflowVersionPicker({ t, workflowId, enabled: !!workflowId })
  const latest = picker.latestVersionNumber
  const hasUnpublishedChanges = picker.hasUnpublishedChanges

  const selectValue: SelectValue = useMemo(() => {
    if (typeof props.value === "number" && Number.isFinite(props.value)) return `v:${Math.floor(props.value)}` as const
    return "__latest"
  }, [props.value])

  const showDraft = allowDraft && hasUnpublishedChanges

  const latestListLabel = t("common.workflowVersion.latestPublished")
  const latestTriggerLabel =
    latest != null
      ? t("common.workflowVersion.latestPublishedWithNumber", { version: latest })
      : t("common.workflowVersion.latestPublished")

  const triggerLabel = useMemo(() => {
    if (selectValue === "__latest") return latestTriggerLabel
    if (selectValue.startsWith("v:")) {
      const n = Number(selectValue.slice(2))
      if (Number.isFinite(n) && n > 0) return `v${String(Math.floor(n))}`
    }
    return latestTriggerLabel
  }, [latestTriggerLabel, selectValue, t])

  async function onValueChange(v: string) {
    const raw = String(v ?? "") as SelectOptionValue
    if (raw === "__latest") {
      props.onChange(null)
      return
    }
    if (raw === "__draft") {
      if (creatingDraft) return
      setCreatingDraft(true)
      try {
        const ver = await picker.createVersionFromDraft()
        props.onChange(ver)
      } finally {
        setCreatingDraft(false)
      }
      return
    }
    if (raw.startsWith("v:")) {
      const n = Number(raw.slice(2))
      if (Number.isFinite(n) && n > 0) props.onChange(Math.floor(n))
    }
  }

  const uiDisabled = disabled || creatingDraft || !workflowId
  const showUnpublishedBadge = hasUnpublishedChanges && selectValue === "__latest"

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <FieldLabelWithHelp label={t("common.workflowVersion.label")} tooltip={props.labelTooltip} />
        {showUnpublishedBadge ? (
          <Badge variant="outline" className="text-[10px]" title={t("common.workflowVersion.unpublishedTooltip")}>
            <span className="inline-flex items-center gap-1">
              <Tag className="size-3" aria-hidden={true} />
              <span>{t("common.workflowVersion.unpublishedBadge")}</span>
            </span>
          </Badge>
        ) : null}
      </div>

      <Select value={selectValue} onValueChange={onValueChange} disabled={uiDisabled}>
        <SelectTrigger className="w-full">
          <SelectValue asChild>
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{triggerLabel}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__latest">{latestListLabel}</SelectItem>
          {showDraft ? (
            <SelectItem value="__draft">{t("common.workflowVersion.draftUnpublishedChanges")}</SelectItem>
          ) : null}
          {picker.versionsLoading || picker.metaLoading ? (
            <SelectItem value="__loading" disabled>
              {t("common.loading")}
            </SelectItem>
          ) : null}
          {picker.versions.length ? <SelectSeparator /> : null}
          {picker.versions.length ? (
            picker.versions.map((v) => (
              <SelectItem key={v.version} value={`v:${v.version}`}>
                {`v${String(v.version)}`}
                {v.description ? ` — ${v.description}` : ""}
              </SelectItem>
            ))
          ) : (
            <SelectItem value="__none" disabled>
              {t("common.workflowVersion.noVersions")}
            </SelectItem>
          )}
        </SelectContent>
      </Select>
    </div>
  )
}
