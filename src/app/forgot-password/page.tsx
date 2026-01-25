import { redirect } from "next/navigation"

import { AuthPageShell } from "@/components/auth/auth-page-shell"
import { ForgotPasswordForm } from "@/components/forgot-password-form"
import { getInstallation } from "@/lib/server/installation"

export default async function Page() {
  const installed = await getInstallation()
    .then((i) => Boolean(i?.installedAt))
    .catch(() => false)
  if (!installed) redirect("/setup")

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-4 sm:p-6 md:p-10">
      <div className="w-full max-w-2xl">
        <AuthPageShell titleKey="auth.forgot.title" subtitleKey="auth.forgot.subtitle">
          <ForgotPasswordForm />
        </AuthPageShell>
      </div>
    </div>
  )
}
