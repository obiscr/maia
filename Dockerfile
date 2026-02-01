FROM node:20-slim AS base

# Enable pnpm via Corepack (needed at runtime too, because workflows can install deps dynamically).
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Runtime crypto deps (Prisma / TLS). Keep it minimal.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# -----------------------------------------------------------------------------
# deps: install workspace deps
# -----------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# build: build Next.js (standalone output)
# -----------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma:generate
RUN pnpm run build

# -----------------------------------------------------------------------------
# migrator: run prisma migrate deploy (production)
# -----------------------------------------------------------------------------
FROM base AS migrator
WORKDIR /app

# Prisma CLI is a devDependency; reuse deps stage node_modules.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml ./

# Prisma schema + migrations
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts

# Prisma config depends on this core module (avoid copying full src tree).
COPY src/lib/maia/instance-location-core.ts ./src/lib/maia/instance-location-core.ts

# Migrator entrypoint (includes best-effort backward compatibility preflight)
COPY scripts/migrate-deploy.mjs ./scripts/migrate-deploy.mjs

CMD ["node", "scripts/migrate-deploy.mjs"]

# -----------------------------------------------------------------------------
# runtime: minimal image running the standalone server
# -----------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3690

WORKDIR /app

# Copy standalone server bundle
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Built-in workflow templates (used for first-run UX)
COPY --from=build /app/templates ./templates

# Prisma client runtime bits (standalone may not include prisma schema by default)
COPY --from=build /app/prisma ./prisma

# Ensure local state directory exists (also used as docker volume mount point)
RUN mkdir -p /app/maia-data

EXPOSE 3690

# Next standalone server entrypoint
CMD ["node", "server.js"]

