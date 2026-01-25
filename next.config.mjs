/** @type {import('next').NextConfig} */

// Remote images are disabled by default (more secure/sane for self-host).
// If you need to allow a few remote hosts, set:
//   MAIA_IMAGE_REMOTE_HOSTS=avatars.githubusercontent.com,raw.githubusercontent.com
const remoteImageHosts = String(process.env.MAIA_IMAGE_REMOTE_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

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
  allowedDevOrigins: [],
}

export default nextConfig
