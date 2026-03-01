/** @type {import('next').NextConfig} */

import os from "node:os"

// Remote images are disabled by default (more secure/sane for self-host).
// If you need to allow a few remote hosts, set:
//   MAIA_IMAGE_REMOTE_HOSTS=avatars.githubusercontent.com,raw.githubusercontent.com
const remoteImageHosts = String(process.env.MAIA_IMAGE_REMOTE_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

function normalizeAllowedDevOrigin(value) {
  const raw = String(value ?? "").trim()
  if (!raw) return null

  // Accept hostname patterns (e.g. "*.localhost") as-is.
  if (raw.startsWith("*.")) return raw.toLowerCase()

  try {
    if (raw.includes("://")) return new URL(raw).hostname.toLowerCase()
    // Support "host:port" or "host/path" (we only need hostname).
    return new URL(`http://${raw.replace(/^\/*/, "")}`).hostname.toLowerCase()
  } catch {
    return raw.split("/")[0]?.split(":")[0]?.toLowerCase() ?? null
  }
}

const allowedDevOrigins = String(process.env.MAIA_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .map(normalizeAllowedDevOrigin)
  .filter(Boolean)

function collectLocalIpv4s() {
  const nets = os.networkInterfaces()
  const out = []
  for (const infos of Object.values(nets)) {
    for (const info of infos ?? []) {
      if (!info) continue
      if (info.family !== "IPv4") continue
      if (info.internal) continue
      out.push(info.address)
    }
  }
  return [...new Set(out)]
}

const defaultDevOrigins = (() => {
  const origins = new Set(["localhost", "127.0.0.1"])
  for (const ip of collectLocalIpv4s()) origins.add(ip)
  return [...origins]
})()

const nextConfig = {
  turbopack: {},
  output: "standalone",
  serverExternalPackages: [
    "@prisma/adapter-libsql",
    "@prisma/adapter-better-sqlite3",
    "@libsql/client",
    "libsql",
    "better-sqlite3",
    "bindings",
  ],
  ...(remoteImageHosts.length
    ? {
        images: {
          remotePatterns: remoteImageHosts.map((hostname) => ({
            protocol: "https",
            hostname,
          })),
        },
      }
    : {}),
  allowedDevOrigins: allowedDevOrigins.length ? allowedDevOrigins : defaultDevOrigins,
}

export default nextConfig
