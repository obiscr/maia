import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import { shouldSetSecureCookie } from "@/lib/shared/http/cookie-secure"

const SESSION_COOKIE_NAME = "maia_session"
const RETURN_TO_COOKIE_NAME = "maia_return_to"

function isPublicPath(pathname: string) {
  // Auth/setup flows and the redirect page itself should not be intercepted.
  if (pathname === "/") return false
  if (pathname.startsWith("/api")) return true
  if (pathname.startsWith("/_next")) return true
  if (pathname.startsWith("/signin")) return true
  if (pathname.startsWith("/signup")) return true
  if (pathname.startsWith("/setup")) return true
  if (pathname.startsWith("/otp")) return true
  if (pathname.startsWith("/forgot-password")) return true
  if (pathname.startsWith("/reset-password")) return true
  if (pathname.startsWith("/email-otp")) return true
  if (pathname.startsWith("/magic-link")) return true
  if (pathname.startsWith("/confirm-email")) return true
  if (pathname.startsWith("/auth/magic")) return true
  if (pathname.startsWith("/auth/redirect")) return true

  // Static assets (e.g. anything from /public with a file extension) should not be auth-gated.
  // This avoids browsers receiving HTML from /auth/redirect when they expect a file (manifest/icons/etc).
  if (/\/[^/]+\.[^/]+$/.test(pathname)) return true

  // Static assets at root (Next may request these)
  if (pathname === "/favicon.ico") return true
  if (pathname === "/manifest.json") return true
  if (pathname === "/site.webmanifest") return true
  if (pathname === "/robots.txt") return true
  if (pathname === "/sitemap.xml") return true
  if (pathname.startsWith("/icon")) return true
  if (pathname === "/apple-icon.png") return true
  if (pathname.startsWith("/web-app-manifest-")) return true
  return false
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  if (isPublicPath(pathname)) return NextResponse.next()

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? ""
  const next = `${pathname}${search}`
  const encodedNext = encodeURIComponent(next)

  // Persist returnTo for a short time so server-side redirects (e.g. invalid/expired session)
  // can still recover the deep link even if query params are lost.
  const cookieOpts = {
    path: "/",
    sameSite: "lax" as const,
    secure: shouldSetSecureCookie({ headers: req.headers, url: req.nextUrl.href }),
    maxAge: 2 * 60, // seconds
  }

  if (token) {
    const res = NextResponse.next()
    res.cookies.set(RETURN_TO_COOKIE_NAME, encodedNext, cookieOpts)
    return res
  }

  const url = req.nextUrl.clone()
  url.pathname = "/auth/redirect"
  url.searchParams.set("next", next)
  const res = NextResponse.redirect(url)
  res.cookies.set(RETURN_TO_COOKIE_NAME, encodedNext, cookieOpts)
  return res
}

export const config = {
  // Run on all pages; we still exclude paths in middleware() for clarity.
  matcher: ["/:path*"],
}
