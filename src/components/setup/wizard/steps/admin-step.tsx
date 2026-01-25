"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { useI18n } from "@/components/i18n-provider"
import { apiFetchJson, ApiError } from "@/lib/shared/http/api"
import { tApiError } from "@/lib/shared/i18n/error"
import { toast } from "@/lib/client/toast"

import { useSetupWizardFooter } from "../footer-context"
import { useSetupWizardStatus } from "../status-context"
import type { AdminFormErrors } from "../types"

const adminEmailSchema = z.string().trim().email()
const adminPasswordSchema = z.string().min(8).max(256)

export function AdminStep({
  onNext,
  onBack,
  active = true,
}: {
  onNext: () => void
  onBack: () => void
  active?: boolean
}) {
  const { t } = useI18n()
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement | null>(null)

  const { refreshStatus } = useSetupWizardStatus()

  const [name, setName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [errors, setErrors] = React.useState<AdminFormErrors>({})
  const [validatedOnce, setValidatedOnce] = React.useState(false)

  function validate(values: {
    name: string
    email: string
    password: string
    confirmPassword: string
  }): AdminFormErrors {
    const next: AdminFormErrors = {}

    if (!values.name.trim()) next.name = t("setupWizard.admin.nameRequired")

    const emailTrim = values.email.trim()
    if (!emailTrim) next.email = t("setupWizard.admin.emailRequired")
    else if (!adminEmailSchema.safeParse(emailTrim).success) next.email = t("setupWizard.admin.emailInvalid")

    if (!values.password) next.password = t("setupWizard.admin.passwordRequired")
    else {
      const parsed = adminPasswordSchema.safeParse(values.password)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        if (issue?.code === "too_small") next.password = t("setupWizard.admin.passwordTooShort")
        else if (issue?.code === "too_big") next.password = t("setupWizard.admin.passwordTooLong")
        else next.password = t("setupWizard.admin.passwordTooShort")
      }
    }

    if (!values.confirmPassword) next.confirmPassword = t("setupWizard.admin.confirmPasswordRequired")
    else if (values.password !== values.confirmPassword) next.confirmPassword = t("errors.PASSWORD_MISMATCH")

    return next
  }

  function revalidate(nextValues: { name: string; email: string; password: string; confirmPassword: string }) {
    if (!validatedOnce) return
    setErrors(validate(nextValues))
  }

  const isValid = !validatedOnce || Object.keys(errors).length === 0

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return

    setValidatedOnce(true)
    const nextErrors = validate({ name, email, password, confirmPassword })
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    try {
      await apiFetchJson("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, name: name.trim() }),
      })
      toast.success(t("setupWizard.admin.created"))
      void refreshStatus()
      onNext()
    } catch (err) {
      if (err instanceof ApiError && err.code === "ALREADY_INITIALIZED") {
        const s = await refreshStatus()
        if (s?.user) {
          onNext()
          return
        }
        router.replace("/signin")
        router.refresh()
        return
      }
      toast.error(tApiError({ t, err, fallbackKey: "errors.HTTP_ERROR" }))
    } finally {
      setSubmitting(false)
    }
  }

  useSetupWizardFooter(
    () => (
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={submitting}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("setupWizard.actions.backAction")}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => formRef.current?.requestSubmit()}
          disabled={submitting || !isValid}
        >
          {submitting && <Spinner aria-label={t("common.loading")} />}
          {t("setupWizard.admin.createAndContinueAction")}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
      </div>
    ),
    [onBack, submitting, isValid, t],
    active,
  )

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="admin-name">{t("common.fields.fullName")}</FieldLabel>
          <Input
            id="admin-name"
            type="text"
            className="font-mono text-xs"
            autoComplete="name"
            placeholder={t("setupWizard.admin.namePlaceholder")}
            value={name}
            onChange={(e) => {
              const v = e.target.value
              setName(v)
              revalidate({ name: v, email, password, confirmPassword })
            }}
            disabled={submitting}
            aria-invalid={errors.name ? true : undefined}
          />
          {errors.name ? <FieldDescription>{errors.name}</FieldDescription> : null}
        </Field>

        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="admin-email">{t("common.fields.email")}</FieldLabel>
          <Input
            id="admin-email"
            type="email"
            className="font-mono text-xs"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              const v = e.target.value
              setEmail(v)
              revalidate({ name, email: v, password, confirmPassword })
            }}
            disabled={submitting}
            aria-invalid={errors.email ? true : undefined}
          />
          {errors.email ? (
            <FieldDescription>{errors.email}</FieldDescription>
          ) : (
            <FieldDescription>{t("setupWizard.admin.emailHint")}</FieldDescription>
          )}
        </Field>

        <Field data-invalid={errors.password ? true : undefined}>
          <FieldLabel htmlFor="admin-password">{t("common.fields.password")}</FieldLabel>
          <Input
            id="admin-password"
            type="password"
            className="font-mono text-xs"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              const v = e.target.value
              setPassword(v)
              revalidate({ name, email, password: v, confirmPassword })
            }}
            disabled={submitting}
            aria-invalid={errors.password ? true : undefined}
          />
          {errors.password ? (
            <FieldDescription>{errors.password}</FieldDescription>
          ) : (
            <FieldDescription>{t("setupWizard.admin.passwordHint")}</FieldDescription>
          )}
        </Field>

        <Field data-invalid={errors.confirmPassword ? true : undefined}>
          <FieldLabel htmlFor="admin-confirm-password">{t("setupWizard.admin.confirmPassword")}</FieldLabel>
          <Input
            id="admin-confirm-password"
            type="password"
            className="font-mono text-xs"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => {
              const v = e.target.value
              setConfirmPassword(v)
              revalidate({ name, email, password, confirmPassword: v })
            }}
            disabled={submitting}
            aria-invalid={errors.confirmPassword ? true : undefined}
          />
          {errors.confirmPassword ? <FieldDescription>{errors.confirmPassword}</FieldDescription> : null}
        </Field>
      </FieldGroup>
    </form>
  )
}
