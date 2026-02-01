"use client"

// NOTE: `global-error.tsx` must render its own <html>/<body> and cannot rely on RootLayout providers.

import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <div
          style={{
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
            padding: "32px",
            maxWidth: "720px",
            margin: "0 auto",
          }}
        >
          <h1 style={{ fontSize: "20px", margin: "0 0 8px 0" }}>Something went wrong</h1>
          <p style={{ margin: "0 0 16px 0", color: "#555" }}>
            An unexpected error occurred. You can try again or go back to the home page.
          </p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Button
              type="button"
              onClick={() => props.reset()}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid #ddd",
                background: "#111",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Try again
            </Button>
            <Link href="/" style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #ddd" }}>
              Home
            </Link>
          </div>
        </div>
      </body>
    </html>
  )
}
