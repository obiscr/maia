import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AuthPageShell } from "@/components/auth/auth-page-shell"
import { SignupCheckEmailContent } from "@/components/signup-check-email-content"
import { getT } from "@/lib/server/i18n/server"
import { getInstallation } from "@/lib/server/installation"

type SearchParams = Record<string, string | string[] | undefined>

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT()
  return { title: t("auth.signup.checkEmail.title") }
}

export default async function Page({ searchParams }: { searchParams?: SearchParams }) {
  const installed = await getInstallation()
    .then((i) => Boolean(i?.installedAt))
    .catch(() => false)
  if (!installed) redirect("/setup")

  const sp = await Promise.resolve(searchParams ?? {})
  const email = typeof sp.email === "string" ? String(sp.email ?? "").trim() : ""

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-4 sm:p-6 md:p-10">
      <div className="w-full max-w-2xl">
        <AuthPageShell titleKey="auth.signup.checkEmail.title" subtitleKey="auth.signup.checkEmail.subtitle">
          <SignupCheckEmailContent email={email || undefined} />
        </AuthPageShell>
      </div>
    </div>
  )
}
