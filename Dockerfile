# Basic single-stage build, just enough to run under docker-compose for
# local dev. Hardened (multi-stage, non-root user, slimmer final image) in
# a later commit dedicated to production packaging.
FROM node:22-slim

WORKDIR /app

# Copied separately from the rest of the source so `npm ci` — and its
# postinstall `prisma generate`, which needs the schema — is cached across
# builds unless dependencies or the schema actually change.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
