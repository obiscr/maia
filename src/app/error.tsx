"use client"

import Link from "next/link"

import { ErrorAlert } from "@/components/common/error-alert"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"

export default function GlobalErrorPage(props: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n()

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 py-10">
      <ErrorAlert error={props.error} titleKey="common.error" descriptionKey="common.errorDescription">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={props.reset}>
            {t("common.refreshAction")}
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href="/">{t("common.goHomeAction")}</Link>
          </Button>
        </div>
      </ErrorAlert>
    </div>
  )
}
