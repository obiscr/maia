"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"

export function SignupCheckEmailContent(props: { email?: string }) {
  const { t } = useI18n()
  const email = String(props.email ?? "").trim()

  return (
    <div className="flex flex-col gap-6">
      <div className="text-sm text-muted-foreground">
        <p>{email ? t("auth.signup.checkEmail.sentTo", { email }) : t("auth.signup.checkEmail.sent")}</p>
        <p className="mt-2">{t("auth.signup.checkEmail.hint")}</p>
      </div>

      <div className="flex flex-col gap-2">
        <Button asChild className="w-full">
          <Link href="/auth/redirect">{t("auth.signup.checkEmail.continueAction")}</Link>
        </Button>
        <Button asChild variant="outline" className="w-full">
          <Link href="/signin">{t("auth.signup.checkEmail.backToSigninAction")}</Link>
        </Button>
      </div>
    </div>
  )
}
