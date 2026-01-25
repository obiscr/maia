"use client"

import * as React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 10_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
      },
    },
  })
}

let browserQueryClient: QueryClient | null = null

function getQueryClient() {
  // On the server: always create a new client (per request).
  if (typeof window === "undefined") return makeQueryClient()
  // In the browser: reuse a singleton client.
  if (!browserQueryClient) browserQueryClient = makeQueryClient()
  return browserQueryClient
}

export function QueryProvider(props: { children: React.ReactNode }) {
  const [client] = React.useState(() => getQueryClient())
  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
}
