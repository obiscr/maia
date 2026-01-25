import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { ScrollContainerProvider } from "@/components/scroll-container-provider"
import { TimezoneProvider } from "@/components/timezone-provider"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { requireAuthedUser } from "@/lib/server/auth/require"

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  await requireAuthedUser()
  return (
    <TimezoneProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="h-svh overflow-hidden">
          <SiteHeader />
          <ScrollContainerProvider className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-4">
            {children}
          </ScrollContainerProvider>
        </SidebarInset>
      </SidebarProvider>
    </TimezoneProvider>
  )
}
