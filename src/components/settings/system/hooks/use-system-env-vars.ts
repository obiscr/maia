"use client"

import * as React from "react"

import { apiFetchJson } from "@/lib/shared/http/api"

export type SystemEnvVar = {
  // Keep this flexible: server may add new source values.
  source?: any
  effectiveValue?: string
  isSet?: boolean
}

export type SystemEnvVarsMap = Record<string, SystemEnvVar>

export function useSystemEnvVars() {
  const [vars, setVars] = React.useState<SystemEnvVarsMap>({})

  const load = React.useCallback(async () => {
    try {
      const json = await apiFetchJson<{
        vars?: { name: string; source?: any; effectiveValue?: string; isSet?: boolean }[]
      }>("/api/settings/system/env", { method: "GET" })

      const map: SystemEnvVarsMap = {}
      for (const v of json.vars ?? []) {
        if (!v?.name) continue
        map[String(v.name)] = { source: v.source, effectiveValue: v.effectiveValue, isSet: v.isSet }
      }
      setVars(map)
    } catch {
      // non-fatal; keep default-only view
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  return { vars, reload: load }
}
