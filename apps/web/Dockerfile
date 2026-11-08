# Multi-stage build for the Lift web app inside a pnpm workspace.
#
# Same shape as apps/landing/Dockerfile: the build stage needs the workspace
# root, the runtime stage carries Next's standalone output and nothing else.
#
# A server, not static files, because `app/api/*` proxies sign-in and sync to
# the Lift API. That is what keeps the session token in an httpOnly cookie and
# spares the API from having to trust this origin.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

ENV CI=true
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------- deps ------
FROM base AS deps

# Every workspace manifest, because `--frozen-lockfile` compares the lockfile
# against each project it names. See apps/landing/Dockerfile.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY apps/landing/package.json apps/landing/
COPY apps/web/package.json apps/web/

# pnpm hashes every patch named in pnpm-workspace.yaml at install time, used or
# not, so the directory has to be present.
COPY patches patches/

# Isolated rather than hoisted, for Next's file tracer: see apps/landing/Dockerfile.
RUN pnpm install --frozen-lockfile --filter @lift/web... --config.node-linker=isolated

# --------------------------------------------------------------- build ------
FROM deps AS build

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

# `prebuild` compiles @lift/shared first: the web app reads its `dist`, the
# same as the API does.
RUN pnpm --filter @lift/web build

# ------------------------------------------------------------- runtime ------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node

EXPOSE 3000

# The sign-in page needs no session and no API, so it answers whenever the
# server itself is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:3000/sign-in || exit 1

# Read at runtime by the proxy routes, not baked in: moving the API means
# restarting this container, not rebuilding it.
#   LIFT_API_URL   the Lift API's public URL, e.g. https://lift-api.example.com
CMD ["node", "apps/web/server.js"]
