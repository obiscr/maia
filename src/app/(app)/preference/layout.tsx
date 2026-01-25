import type { ReactNode } from "react"

import { SettingsShell } from "@/components/settings/settings-shell"

export default function PreferenceLayout({ children }: { children: ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>
}
