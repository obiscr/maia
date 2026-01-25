"use client"

import * as React from "react"

import { apiFetchJson } from "@/lib/shared/http/api"

type TimezoneSettings = { timezone: string | null }

type TimezoneContextValue = {
  /** User preference (persisted). null => use browser timezone. */
  userTimezone: string | null
  /** Effective timezone used for display. */
  effectiveTimezone: string
  loading: boolean
  refresh: () => Promise<void>
  setUserTimezone: (timezone: string | null) => Promise<void>
}

function getBrowserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

const TimezoneContext = React.createContext<TimezoneContextValue | null>(null)

export function TimezoneProvider(props: { children: React.ReactNode }) {
  const browserTz = React.useMemo(() => getBrowserTimezone(), [])
  const [loading, setLoading] = React.useState(true)
  const [userTimezone, setUserTimezoneState] = React.useState<string | null>(null)

  const effectiveTimezone = React.useMemo(() => userTimezone || browserTz || "UTC", [browserTz, userTimezone])

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const json = await apiFetchJson<{ settings?: Partial<TimezoneSettings> }>("/api/settings/timezone", {
        method: "GET",
      })
      const tz = typeof json?.settings?.timezone === "string" ? String(json.settings.timezone) : null
      setUserTimezoneState(tz)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const setUserTimezone = React.useCallback(async (timezone: string | null) => {
    const json = await apiFetchJson<{ settings?: Partial<TimezoneSettings> }>("/api/settings/timezone", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone }),
    })
    const tz = typeof json?.settings?.timezone === "string" ? String(json.settings.timezone) : null
    setUserTimezoneState(tz)
  }, [])

  const value = React.useMemo<TimezoneContextValue>(
    () => ({
      userTimezone,
      effectiveTimezone,
      loading,
      refresh,
      setUserTimezone,
    }),
    [effectiveTimezone, loading, refresh, setUserTimezone, userTimezone],
  )

  return <TimezoneContext.Provider value={value}>{props.children}</TimezoneContext.Provider>
}

export function useTimezone() {
  const ctx = React.useContext(TimezoneContext)
  if (!ctx) throw new Error("useTimezone must be used within TimezoneProvider")
  return ctx
}
