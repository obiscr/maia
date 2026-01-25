import Link from "next/link"
import { Activity, Clock, FileQuestionIcon, HomeIcon, Layers, ListChecks, PlayIcon, WorkflowIcon } from "lucide-react"
import type { Metadata } from "next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { getT } from "@/lib/server/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return {
    title: t("common.notFoundTitle"),
    description: t("common.notFoundDescription"),
  }
}

export default async function NotFound() {
  const { t } = await getT()

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-12">
      <Alert className="rounded-md">
        <FileQuestionIcon />
        <AlertTitle>{t("common.notFoundTitle")}</AlertTitle>
        <AlertDescription>
          <p className="max-w-prose">{t("common.notFoundDescription")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href="/">
                <HomeIcon />
                {t("common.goHomeAction")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href="/workflows">
                <WorkflowIcon />
                {t("nav.workflows")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href="/runs">
                <PlayIcon />
                {t("nav.runs")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href="/jobs">
                <ListChecks />
                {t("nav.jobs")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href="/schedules">
                <Clock />
                {t("nav.schedules")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href="/batches">
                <Layers />
                {t("nav.batches")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href="/operations">
                <Activity />
                {t("nav.operations")}
              </Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  )
}
