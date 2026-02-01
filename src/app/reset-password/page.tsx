"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { AuthPageShell } from "@/components/auth/auth-page-shell"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/components/i18n-provider"
import { apiFetchJson, ApiError } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"
import { useApiErrorToast } from "@/hooks/use-api-error-toast"

export default function Page() {
  const { t } = useI18n()
  const { toastApiError } = useApiErrorToast()
  const router = useRouter()
  const sp = useSearchParams()
  const token = sp.get("token") ?? ""

  const [password, setPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!token.trim()) {
      toast.error(t("auth.reset.errors.tokenMissing"))
      return
    }
    if (password !== confirmPassword) {
      toast.error(t("errors.PASSWORD_MISMATCH"))
      return
    }
    setSubmitting(true)
    try {
      await apiFetchJson("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      toast.success(t("auth.reset.success"))
      router.replace("/signin")
      router.refresh()
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.code === "TOKEN_INVALID" || e.code === "TOKEN_USED" || e.code === "TOKEN_EXPIRED")
      ) {
        toast.error(t("auth.reset.errors.tokenInvalidOrExpired"))
        return
      }
      toastApiError(e, "auth.reset.errors.resetFailed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-4 sm:p-6 md:p-10">
      <div className="w-full max-w-2xl">
        <AuthPageShell titleKey="auth.reset.title" subtitleKey="auth.reset.subtitle">
          <form onSubmit={onSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="password">{t("auth.reset.newPassword")}</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="font-mono text-xs"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                />
                <FieldDescription>{t("auth.reset.newPasswordHint")}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="confirm-password">{t("auth.reset.confirmPassword")}</FieldLabel>
                <Input
                  id="confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="font-mono text-xs"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={submitting}
                />
              </Field>
              <Field>
                <Button className="w-full" type="submit" disabled={submitting}>
                  {t("auth.reset.submitAction")}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </AuthPageShell>
      </div>
    </div>
  )
}
