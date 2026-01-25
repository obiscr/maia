"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/components/i18n-provider"
import { apiFetchJson, ApiError } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"
import { cn } from "@/lib/utils"

export function ForgotPasswordForm({ className, ...props }: React.ComponentProps<"div">) {
  const { t } = useI18n()
  const router = useRouter()
  const [email, setEmail] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [sent, setSent] = React.useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const res = await apiFetchJson<{ ok?: boolean; smtpAvailable?: boolean; smtpCode?: string }>(
        "/api/auth/password/forgot",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        },
      )
      if (res?.smtpAvailable === false) {
        toast.error(t("auth.forgot.errors.smtpUnavailable"))
        return
      }
      setSent(true)
      toast.success(t("auth.forgot.sentToast"))
    } catch (e) {
      const msg =
        e instanceof ApiError && e.code === "RATE_LIMITED"
          ? t("auth.forgot.errors.rateLimited")
          : t("auth.forgot.errors.requestFailed")
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <div className={cn("flex flex-col gap-4", className)} {...props}>
        <div className="text-sm text-muted-foreground">{t("auth.forgot.sentHint")}</div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            router.replace("/signin")
            router.refresh()
          }}
        >
          {t("auth.forgot.backToSigninAction")}
        </Button>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form onSubmit={onSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="email">{t("common.fields.email")}</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              className="font-mono text-xs"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
            <FieldDescription>{t("auth.forgot.emailHint")}</FieldDescription>
          </Field>
          <Field>
            <Button className="w-full" type="submit" disabled={submitting}>
              {t("auth.forgot.submitAction")}
            </Button>
          </Field>
          <FieldDescription className="text-center">
            <a
              href="#"
              className="underline underline-offset-4 hover:no-underline"
              onClick={(e) => {
                e.preventDefault()
                router.push("/signin")
              }}
            >
              {t("auth.forgot.backToSigninAction")}
            </a>
          </FieldDescription>
        </FieldGroup>
      </form>
    </div>
  )
}
