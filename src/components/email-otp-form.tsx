"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/components/i18n-provider"
import { apiFetchJson, ApiError } from "@/lib/shared/http/api"
import { sanitizeNext } from "@/lib/shared/http/sanitize-next"
import { toast } from "@/lib/client/toast"
import { cn } from "@/lib/utils"

export function EmailOtpForm({ className, ...props }: React.ComponentProps<"div">) {
  const { t } = useI18n()
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextRaw = searchParams.get("next")
  const signinHref = nextRaw ? `/signin?next=${encodeURIComponent(nextRaw)}` : "/signin"

  const [email, setEmail] = React.useState("")
  const [code, setCode] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [requested, setRequested] = React.useState(false)

  async function requestCode() {
    if (submitting) return
    setSubmitting(true)
    try {
      await apiFetchJson<{ ok?: boolean }>("/api/auth/email-otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      setRequested(true)
      toast.success(t("auth.emailOtp.sentToast"))
    } catch (e) {
      const msg =
        e instanceof ApiError && e.code === "RATE_LIMITED"
          ? t("auth.emailOtp.errors.rateLimited")
          : t("auth.emailOtp.errors.requestFailed")
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  async function verifyCode() {
    if (submitting) return
    setSubmitting(true)
    try {
      await apiFetchJson("/api/auth/email-otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      })
      const next = sanitizeNext(searchParams.get("next"))
      router.replace(next)
      router.refresh()
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "TOTP_REQUIRED") {
          const challengeId = typeof e.meta?.challengeId === "string" ? String(e.meta.challengeId) : ""
          if (challengeId) {
            try {
              sessionStorage.setItem("maia_pending_challenge", challengeId)
              sessionStorage.setItem("maia_pending_email", email)
            } catch {}
            const next = sanitizeNext(searchParams.get("next"))
            router.push(`/otp?next=${encodeURIComponent(next)}`)
            return
          }
        }
        if (e.code === "OTP_INVALID") {
          toast.error(t("auth.emailOtp.errors.invalidCode"))
          return
        }
        if (e.code === "OTP_TOO_MANY_ATTEMPTS") {
          toast.error(t("auth.emailOtp.errors.tooManyAttempts"))
          return
        }
      }
      toast.error(t("auth.emailOtp.errors.verifyFailed"))
    } finally {
      setSubmitting(false)
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!requested) await requestCode()
    else await verifyCode()
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
              disabled={submitting || requested}
            />
            <FieldDescription>{t("auth.emailOtp.emailHint")}</FieldDescription>
          </Field>

          {requested ? (
            <Field>
              <FieldLabel htmlFor="code">{t("auth.emailOtp.codeLabel")}</FieldLabel>
              <Input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="font-mono text-xs"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={submitting}
              />
              <FieldDescription>{t("auth.emailOtp.codeHint")}</FieldDescription>
            </Field>
          ) : null}

          <Field>
            <Button className="w-full" type="submit" disabled={submitting}>
              {requested ? t("auth.emailOtp.verifyAction") : t("auth.emailOtp.requestAction")}
            </Button>
          </Field>

          {requested ? (
            <Field>
              <Button className="w-full" type="button" variant="secondary" disabled={submitting} onClick={requestCode}>
                {t("auth.emailOtp.resendAction")}
              </Button>
            </Field>
          ) : null}

          <FieldDescription className="text-center">
            <Link href={signinHref} className="underline underline-offset-4 hover:no-underline">
              {t("auth.emailOtp.backToSigninAction")}
            </Link>
          </FieldDescription>
        </FieldGroup>
      </form>
    </div>
  )
}
