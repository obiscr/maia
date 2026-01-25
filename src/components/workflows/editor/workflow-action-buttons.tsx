"use client"

import Link from "next/link"
import { Play, Save, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import { Spinner } from "@/components/ui/spinner"

export function WorkflowActionButtons(props: {
  workflowId: string
  saving: boolean
  deletePending: boolean
  onSaveWorkflow: () => void
  onDeleteWorkflow: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="mt-2 flex flex-col gap-2">
      <Button size="sm" className="w-full justify-start" asChild>
        <Link href={`/jobs?action=new&workflowId=${encodeURIComponent(props.workflowId)}`}>
          <Play />
          {t("workflows.createJobAction")}
        </Link>
      </Button>

      <Button
        size="sm"
        variant="secondary"
        className="w-full justify-start"
        onClick={props.onSaveWorkflow}
        disabled={props.saving}
      >
        {props.saving ? <Spinner className="size-6" /> : <Save />}
        {props.saving ? t("common.saving") : t("workflows.saveWorkflowAction")}
      </Button>

      <Button
        size="sm"
        variant="secondary"
        onClick={props.onDeleteWorkflow}
        disabled={props.deletePending}
        className="w-full justify-start cursor-pointer bg-red-500/10 text-red-700 hover:bg-red-500/15 hover:text-red-800 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20 dark:hover:text-red-200"
        aria-label={t("workflows.deleteWorkflowAction")}
      >
        <Trash2Icon className="size-4" />
        {t("workflows.deleteWorkflowAction")}
      </Button>
    </div>
  )
}
