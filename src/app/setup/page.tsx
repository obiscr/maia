import { SetupWizard } from "@/components/setup/setup-wizard"

export default async function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-4 sm:p-6 md:p-10">
      <div className="w-full max-w-2xl">
        <SetupWizard />
      </div>
    </div>
  )
}
