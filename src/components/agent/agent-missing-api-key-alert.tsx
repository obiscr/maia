"use client"

import Link from "next/link"

import { InfoAlert } from "@/components/common/info-alert"
import { useI18n } from "@/components/i18n-provider"
import { cn } from "@/lib/utils"

export function AgentMissingApiKeyAlert(props: { className?: string }) {
  const { t } = useI18n()

  return (
    <InfoAlert
      className={cn(props.className)}
      titleKey="agent.chat.missingApiKeyAlertTitle"
      description={
        <div className="flex flex-col gap-2">
          {t("agent.chat.missingApiKeyAlertDescription")}{" "}
          <Link href="/preference/agent" className="underline underline-offset-4 w-fit">
            {t("agent.chat.missingApiKeyAlertAction")}
          </Link>
        </div>
      }
    />
  )
}
