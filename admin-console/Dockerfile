# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.14-alpine AS dependencies

WORKDIR /workspace/admin-console

COPY admin-console/package.json admin-console/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

FROM oven/bun:1.3.14-alpine AS build

WORKDIR /workspace/admin-console

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_ASTRAFLOW_ADMIN_BASE_PATH=/astraflow-admin

COPY --from=dependencies /workspace/admin-console/node_modules ./node_modules
COPY admin-console/ ./

RUN bun run build

FROM node:24-alpine AS runtime

WORKDIR /app

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_ASTRAFLOW_ADMIN_BASE_PATH=/astraflow-admin
ENV PORT=3000

COPY --from=build --chown=node:node /workspace/admin-console/.next/standalone ./
COPY --from=build --chown=node:node /workspace/admin-console/.next/static ./.next/static
COPY --from=build --chown=node:node /workspace/admin-console/public ./public

USER node

EXPOSE 3000

CMD ["node", "server.js"]
