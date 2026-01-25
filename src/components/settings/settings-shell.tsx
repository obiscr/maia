import type { ReactNode } from "react"

import { SettingsNav } from "@/components/settings/settings-nav"
import { requireAuthedUser } from "@/lib/server/auth/require"

export async function SettingsShell({ children }: { children: ReactNode }) {
  const user = await requireAuthedUser()
  const showSystem = String(user.role) === "ADMIN"

  return (
    <div className="mx-auto flex w-full max-w-6xl min-h-0 flex-1 flex-col px-4 py-6">
      <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row">
        <aside className="w-full shrink-0 lg:w-64">
          <SettingsNav showSystem={showSystem} />
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
