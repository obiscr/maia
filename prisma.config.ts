import { defineConfig } from "prisma/config"

import { resolveMaiaDataDirSync, toSqliteDatabaseUrl } from "./src/lib/maia/instance-location-core"

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Default to local SQLite file; can be overridden via env.
    url: toSqliteDatabaseUrl(resolveMaiaDataDirSync()),
  },
})
