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

export function SignupForm({ className, ...props }: React.ComponentProps<"div">) {
  const { t } = useI18n()
  const { toastApiError } = useApiErrorToast()
  const router = useRouter()
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
      await apiFetchJson("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      })
      router.replace("/")
      router.refresh()
    } catch (err) {
      toastApiError(err, "auth.signup.errors.createAccountFailed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form onSubmit={onSubmit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="name">{t("auth.signup.name")}</FieldLabel>
            <Input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              placeholder={t("auth.signup.namePlaceholder")}
              required
              value={name}
              className="font-mono text-xs"
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">{t("common.fields.email")}</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              required
              value={email}
              className="font-mono text-xs"
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
            <FieldDescription>{t("auth.signup.emailHint")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="password">{t("common.fields.password")}</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              className="font-mono text-xs"
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
            <FieldDescription>{t("auth.signup.passwordHint")}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm-password">{t("auth.signup.confirmPassword")}</FieldLabel>
            <Input
              id="confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              className="font-mono text-xs"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={submitting}
            />
            <FieldDescription>{t("auth.signup.confirmPasswordHint")}</FieldDescription>
          </Field>
          <FieldGroup>
            <Field>
              <Button className="w-full" type="submit" disabled={submitting}>
                {t("auth.signup.submitAction")}
              </Button>
              <FieldDescription className="px-6 text-center">
                {t("auth.signup.alreadyHave")}{" "}
                <a
                  href="#"
                  className="underline underline-offset-4 hover:no-underline"
                  onClick={(e) => {
                    e.preventDefault()
                    router.push("/signin")
                  }}
                >
                  {t("auth.signup.signinLinkAction")}
                </a>
              </FieldDescription>
            </Field>
          </FieldGroup>
        </FieldGroup>
      </form>
    </div>
  )
}
