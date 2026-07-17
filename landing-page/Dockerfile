# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.14-alpine AS build

WORKDIR /workspace/landing-page

COPY landing-page/package.json landing-page/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

COPY landing-page/ ./
COPY public/ /workspace/public/

RUN bun run build

FROM nginxinc/nginx-unprivileged:1.29.4-alpine AS runtime

COPY landing-page/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /workspace/landing-page/dist/ /usr/share/nginx/html/

USER 101:101

EXPOSE 8080

STOPSIGNAL SIGQUIT

CMD ["nginx", "-g", "daemon off;"]
