import type { Metadata } from "next"
import { SigninForm } from "@/components/signin-form"
import { AuthPageShell } from "@/components/auth/auth-page-shell"
import { getT } from "@/lib/server/i18n/server"
import { getInstallation } from "@/lib/server/installation"
import { redirect } from "next/navigation"

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t("auth.signin.title") }
}

export default async function Page() {
  const installed = await getInstallation()
    .then((i) => Boolean(i?.installedAt))
    .catch(() => false)
  if (!installed) redirect("/setup")
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-4 sm:p-6 md:p-10">
      <div className="w-full max-w-2xl">
        <AuthPageShell titleKey="auth.signin.title" subtitleKey="auth.signin.subtitle">
          <SigninForm />
        </AuthPageShell>
      </div>
    </div>
  )
}
