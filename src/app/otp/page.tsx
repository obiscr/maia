import type { Metadata } from "next"
import { OTPForm } from "@/components/otp-form"
import { AuthPageShell } from "@/components/auth/auth-page-shell"
import { getT } from "@/lib/server/i18n/server"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t("auth.otp.title") }
}

export default function OTPPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-4 sm:p-6 md:p-10">
      <div className="w-full max-w-2xl">
        <AuthPageShell titleKey="auth.otp.title" subtitleKey="auth.otp.subtitle">
          <OTPForm />
        </AuthPageShell>
      </div>
    </div>
  )
}
