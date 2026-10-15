# syntax=docker/dockerfile:1
FROM node:24.11.0-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY package.json pnpm-lock.yaml ./
COPY plugins ./plugins
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24.11.0-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && curl --fail --silent --show-error https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
       -o /etc/ssl/certs/rds-global-bundle.pem \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem
# The non-root runtime must share the preinstalled pnpm cache without downloading at startup.
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
COPY --from=builder --chown=node:node /app /app
USER node
EXPOSE 3000
ENTRYPOINT ["/bin/sh", "/app/scripts/docker-entrypoint.sh"]
CMD ["node", "server-production.mjs"]
