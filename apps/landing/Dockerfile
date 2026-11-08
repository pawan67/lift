# Multi-stage build for the Lift landing page inside a pnpm workspace.
#
# The build stage needs the workspace root (lockfile, every manifest the
# lockfile names); the runtime stage carries Next's standalone output and
# nothing else. No pnpm and no source survive into the image that ships.
#
# Unlike apps/mobile/Dockerfile this is a *server*, not a directory of static
# files behind nginx. The download button reads the current release from the
# GitHub API and revalidates hourly, which needs something running to revalidate
# with — see the note on `output` in apps/landing/next.config.ts.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

# pnpm asks before replacing an existing node_modules and aborts when there is
# no terminal to ask. Nothing here is interactive.
ENV CI=true
# Nothing in a container build wants to phone home about the build.
ENV NEXT_TELEMETRY_DISABLED=1

# ---------------------------------------------------------------- deps ------
FROM base AS deps

# Manifests first so a source-only change doesn't invalidate the install layer.
# The API's and the mobile app's are copied too, not because anything here needs
# them, but because `--frozen-lockfile` compares the lockfile against every
# workspace project it names: with one manifest missing the install fails as out
# of date.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY apps/landing/package.json apps/landing/
COPY apps/web/package.json apps/web/

# The patch file `pnpm-workspace.yaml` names under `patchedDependencies`. pnpm
# hashes every patch it is told about at install time, before it knows whether
# this image will use the package the patch applies to, so leaving `patches/`
# out of the context fails the install outright with ENOENT rather than being
# skipped as irrelevant. The landing page never loads expo-sqlite; it still
# needs the file on disk. Same reasoning as the manifests above.
COPY patches patches/

# The isolated linker overrides the root .npmrc, which hoists for Metro's sake.
# That is a mobile-development concern this build has no stake in, and hoisting
# actively hurts here: Next's file tracer follows the resolution it is given, so
# a hoisted tree puts packages at the workspace root that the standalone output
# then has to be told about. Isolated keeps every dependency where its own
# package expects to find it.
RUN pnpm install --frozen-lockfile --filter @lift/landing... --config.node-linker=isolated

# --------------------------------------------------------------- build ------
FROM deps AS build

# Baked in, not read at runtime.
#
# `NEXT_PUBLIC_*` is substituted into the bundle by the compiler, so this is a
# property of the image rather than of the container: starting it with a
# different value changes nothing, and moving the site means rebuilding.
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

# Refused rather than defaulted, and refused here rather than discovered in
# somebody's Slack. Unset, `metadataBase` falls back to localhost and every
# share preview resolves its image against a machine that is not the one the
# link came from — the page looks perfect and the card comes back blank.
RUN test -n "$NEXT_PUBLIC_SITE_URL" || { \
      echo 'NEXT_PUBLIC_SITE_URL is empty. Pass it as a build arg — it is baked into the bundle.'; \
      exit 1; \
    }

COPY tsconfig.base.json ./
COPY apps/landing apps/landing

# The screenshots the page frames, which live at the repository root because the
# README shows the same set — see the note at the top of `lib/screens.ts`. They
# are statically imported rather than served out of `public`, so the build reads
# them off disk here and emits them into `.next/static`; leave this out and the
# build fails on an unresolved import rather than shipping a page with holes in
# it. Nothing needs them at runtime.
COPY screenshots screenshots

# The build prerenders the page, which includes one call to the GitHub releases
# API. It is allowed to fail: `latestRelease` answers null and the page ships
# without a version rather than with a guessed one, and the first revalidation
# after the container starts fills it in. So a build behind a firewall produces
# a correct page, just a less specific one.
RUN pnpm --filter @lift/landing build

# ------------------------------------------------------------- runtime ------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next's standalone server reads both. Without HOSTNAME it binds to localhost
# inside the container, which is not reachable from Traefik.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# `node` is uid 1000 in this image and already exists. Owned by it rather than
# by root because Next writes its revalidation cache under .next/cache: as root
# the container runs privileged for no reason, and as a user who cannot write
# there every revalidation fails silently and the page freezes at build time.
COPY --from=build --chown=node:node /app/apps/landing/.next/standalone ./

# The tracer deliberately excludes this: it is served, not imported, so nothing
# in the graph points at it. There is no `public` to copy alongside it any more.
# It held the page's screenshots and nothing else, and those are now compiled in
# from `screenshots/` at the repository root, which lands them here.
COPY --from=build --chown=node:node /app/apps/landing/.next/static ./apps/landing/.next/static

USER node

EXPOSE 3000

# Dokploy reads this to decide whether a deploy succeeded. The root document is
# the whole product here — if that is being served, the container is doing its
# job — so there is no separate health route to shadow an app one.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --spider http://127.0.0.1:3000/ || exit 1

# The standalone output keeps the workspace layout, so the entrypoint sits under
# the package's own path rather than at the root.
CMD ["node", "apps/landing/server.js"]
