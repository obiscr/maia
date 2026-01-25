"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/components/i18n-provider"
import { apiFetchJson, ApiError } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"
import { useApiErrorToast } from "@/hooks/use-api-error-toast"

export function SigninForm({ className, ...props }: React.ComponentProps<"div">) {
  const { t } = useI18n()
  const { toastApiError } = useApiErrorToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  const reason = searchParams.get("reason")
  React.useEffect(() => {
    if (!reason) return
    if (reason === "invite_only")
      toast.info(t("auth.signup.toasts.inviteOnly"), { id: "auth:signup:blocked:INVITE_ONLY" })
    else if (reason === "registration_disabled")
      toast.info(t("auth.signup.toasts.registrationDisabled"), { id: "auth:signup:blocked:DISABLED" })
    const next = searchParams.get("next")
    router.replace(next ? `/signin?next=${encodeURIComponent(next)}` : "/signin")
  }, [reason, router, t])

  function sanitizeNext(raw: string | null) {
    const v = String(raw ?? "").trim()
    if (!v) return "/"
    if (!v.startsWith("/")) return "/"
    if (v.startsWith("//")) return "/"
    // Never bounce back into auth pages.
    if (v === "/signin" || v.startsWith("/signin?")) return "/"
    if (v === "/signup" || v.startsWith("/signup?")) return "/"
    if (v === "/otp" || v.startsWith("/otp?")) return "/"
    if (v === "/setup" || v.startsWith("/setup")) return "/"
    if (v === "/auth/redirect" || v.startsWith("/auth/redirect?")) return "/"
    return v
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      await apiFetchJson("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const next = sanitizeNext(searchParams.get("next"))
      router.replace(next)
      router.refresh()
    } catch (err) {
      if (err instanceof ApiError && err.code === "TOTP_REQUIRED") {
        const challengeId = typeof err.meta?.challengeId === "string" ? String(err.meta.challengeId) : ""
        if (!challengeId) {
          toast.error(t("errors.TOTP_REQUIRED"))
          return
        }
        try {
          sessionStorage.setItem("maia_pending_challenge", challengeId)
          sessionStorage.setItem("maia_pending_email", email)
        } catch {}
        const next = sanitizeNext(searchParams.get("next"))
        router.push(`/otp?next=${encodeURIComponent(next)}`)
        return
      }
      if (err instanceof ApiError && err.code === "INVALID_CREDENTIALS") {
        toast.error(t("auth.signin.errors.invalidCredentials"))
        return
      }
      toastApiError(err, "auth.signin.errors.signInFailed")
    } finally {
      setSubmitting(false)
    }
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
          </Field>
          <Field>
            <div className="flex items-center">
              <FieldLabel htmlFor="password">{t("common.fields.password")}</FieldLabel>
              <a
                href="#"
                className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                onClick={(e) => {
                  e.preventDefault()
                  router.push("/forgot-password")
                }}
              >
                {t("auth.signin.forgotPasswordAction")}
              </a>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              className="font-mono text-xs"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
          </Field>
          <Field>
            <Button className="w-full" type="submit" disabled={submitting}>
              {t("auth.signin.submitAction")}
            </Button>
            <FieldDescription className="text-center">
              {t("auth.signin.noAccount")}{" "}
              <a
                href="#"
                className="underline underline-offset-4 hover:no-underline"
                onClick={(e) => {
                  e.preventDefault()
                  router.push("/signup")
                }}
              >
                {t("auth.signin.signupLinkAction")}
              </a>
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </div>
  )
}
