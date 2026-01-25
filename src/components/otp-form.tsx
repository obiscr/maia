"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup } from "@/components/ui/field"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { useI18n } from "@/components/i18n-provider"
import { apiFetchJson, ApiError } from "@/lib/shared/http/api"
import { toast } from "@/lib/client/toast"
import { useApiErrorToast } from "@/hooks/use-api-error-toast"

export function OTPForm({ className, ...props }: React.ComponentProps<"div">) {
  const { t } = useI18n()
  const { toastApiError } = useApiErrorToast()
  const router = useRouter()
  const [otp, setOtp] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const challengeId = sessionStorage.getItem("maia_pending_challenge") || ""
      if (!challengeId) {
        router.replace("/signin")
        router.refresh()
        return
      }
      await apiFetchJson("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, code: otp }),
      })
      try {
        sessionStorage.removeItem("maia_pending_challenge")
        sessionStorage.removeItem("maia_pending_email")
      } catch {}
      router.replace("/")
      router.refresh()
    } catch (err) {
      if (err instanceof ApiError && err.code === "TOTP_INVALID") toast.error(t("auth.otp.errors.invalidCode"))
      else if (err instanceof ApiError && err.code === "CHALLENGE_INVALID")
        toast.error(t("auth.otp.errors.sessionExpired"))
      else toastApiError(err, "auth.otp.errors.verifyFailed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form onSubmit={onSubmit}>
        <FieldGroup>
          <Field>
            <InputOTP
              maxLength={6}
              id="otp"
              required
              value={otp}
              onChange={setOtp}
              disabled={submitting}
              aria-label={t("auth.otp.codeLabel")}
            >
              <InputOTPGroup className="mx-auto w-fit justify-center gap-2.5 *:data-[slot=input-otp-slot]:rounded-md *:data-[slot=input-otp-slot]:border">
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
            <FieldDescription className="mx-auto max-w-xs text-center">{t("auth.otp.codeHint")}</FieldDescription>
          </Field>
          <FieldGroup>
            <Button className="w-full" type="submit" disabled={submitting}>
              {t("auth.otp.submitAction")}
            </Button>
            <FieldDescription className="text-center">
              {t("auth.otp.noCode")}{" "}
              <a
                href="#"
                className="underline underline-offset-4 hover:no-underline"
                onClick={(e) => {
                  e.preventDefault()
                  toast.message(t("auth.common.notImplemented"))
                }}
              >
                {t("auth.otp.resendAction")}
              </a>
            </FieldDescription>
          </FieldGroup>
        </FieldGroup>
      </form>
    </div>
  )
}
