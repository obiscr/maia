"use client"

import Link from "next/link"

import { useI18n } from "@/components/i18n-provider"
import { ErrorAlert } from "@/components/common/error-alert"
import { Button } from "@/components/ui/button"

export function PageLoadError(props: {
  error: unknown
  onRetry?: () => void
  backHref?: string
  backLabelKey?: string
  className?: string
}) {
  const { t } = useI18n()
  const backLabel = props.backLabelKey ? t(props.backLabelKey) : t("common.backAction")

  return (
    <div className={["mx-auto w-full max-w-2xl py-6", props.className].filter(Boolean).join(" ")}>
      <div className="space-y-3">
        <ErrorAlert
          titleKey="common.loadFailed"
          error={props.error}
          actions={
            props.onRetry
              ? [
                  {
                    key: "refresh",
                    label: t("common.refreshAction"),
                    onClick: () => void props.onRetry?.(),
                  },
                ]
              : undefined
          }
        />
        {props.backHref ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link href={props.backHref}>{backLabel}</Link>
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
