"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/components/i18n-provider"
import { apiFetchJson } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"
import { useApiErrorToast } from "@/hooks/use-api-error-toast"

export function RepairForm({ className, ...props }: React.ComponentProps<"div">) {
  const { t } = useI18n()
  const { toastApiError } = useApiErrorToast()
  const router = useRouter()
  const [token, setToken] = React.useState("")
  const [name, setName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (password !== confirmPassword) {
      toast.error(t("errors.PASSWORD_MISMATCH"))
      return
    }
    setSubmitting(true)
    try {
      await apiFetchJson("/api/auth/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() || undefined, email, password, name }),
      })
      router.replace("/")
      router.refresh()
    } catch (err) {
      toastApiError(err, "auth.repair.errors.repairFailed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form onSubmit={onSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="token">{t("auth.repair.token.label")}</FieldLabel>
            <Input
              id="token"
              type="password"
              placeholder={t("auth.repair.token.placeholder")}
              className="font-mono text-xs"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={submitting}
            />
            <FieldDescription>{t("auth.repair.token.hint")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="name">{t("common.fields.fullName")}</FieldLabel>
            <Input
              id="name"
              type="text"
              placeholder={t("setupWizard.admin.namePlaceholder")}
              required
              className="font-mono text-xs"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">{t("common.fields.email")}</FieldLabel>
            <Input
              id="email"
              type="email"
              placeholder={t("setupWizard.admin.emailPlaceholder")}
              required
              className="font-mono text-xs"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">{t("common.fields.password")}</FieldLabel>
            <Input
              id="password"
              type="password"
              required
              className="font-mono text-xs"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
            <FieldDescription>{t("setupWizard.admin.passwordHint")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm-password">{t("setupWizard.admin.confirmPassword")}</FieldLabel>
            <Input
              id="confirm-password"
              type="password"
              required
              className="font-mono text-xs"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={submitting}
            />
          </Field>
          <Field>
            <Button className="w-full" type="submit" disabled={submitting}>
              {t("setupWizard.admin.createAndContinueAction")}
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </div>
  )
}
