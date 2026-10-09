# ---- build: compile TS (and the generated Prisma client) to dist/ ----
FROM node:22-slim AS build
WORKDIR /app

# Copied separately from the rest of the source so `npm ci` — and its
# postinstall `prisma generate`, which needs the schema — is cached across
# builds unless dependencies or the schema actually change. tsconfig.json
# has to be here too: without it, `prisma generate` can't see this
# project's `module: NodeNext`, and silently falls back to emitting
# internal imports with a bare `.ts` extension instead of `.js` — valid
# for running the TS source directly, but not for code `tsc` is about to
# compile, since nothing rewrites those extensions and the compiled
# dist/ ends up importing a `.ts` file that was never copied into the
# runtime stage.
COPY package.json package-lock.json tsconfig.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime: production deps only, non-root, no build tooling ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs canopychain

COPY --chown=canopychain:nodejs package.json package-lock.json ./
# --ignore-scripts: postinstall (`prisma generate`) already ran in the
# build stage and its output is copied in below — running it again here
# would need the `prisma` CLI, which --omit=dev deliberately excludes.
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build --chown=canopychain:nodejs /app/dist ./dist

USER canopychain

EXPOSE 3000
CMD ["node", "dist/index.js"]
