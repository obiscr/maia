export function scheduleToggleSpec(enabled: boolean): { nextEnabled: boolean; labelKey: string } {
  const nextEnabled = !enabled
  return {
    nextEnabled,
    labelKey: enabled ? "schedules.disableAction" : "schedules.enableAction",
  }
}
