# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.2.23
ARG NODE_VERSION=20-alpine

FROM oven/bun:${BUN_VERSION} AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY src ./src
COPY tsconfig.json tsconfig.build.json tsconfig.test.json ./
RUN bun run build

FROM build AS test
COPY . .
RUN bun run lint && bun run typecheck && bun run test

FROM oven/bun:${BUN_VERSION} AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S umft && adduser -S -G umft -h /home/umft umft
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN printf '#!/bin/sh\nexec node /app/dist/cli.js "$@"\n' > /usr/local/bin/umft \
  && chmod +x /usr/local/bin/umft /app/dist/cli.js \
  && chown -R umft:umft /app /home/umft
USER umft
ENTRYPOINT ["umft"]
CMD ["--help"]

FROM node:${NODE_VERSION} AS e2e
ENV NODE_ENV=development
WORKDIR /app
RUN addgroup -S umft && adduser -S -G umft -h /home/umft umft
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN printf '#!/bin/sh\nexec node /app/dist/cli.js "$@"\n' > /usr/local/bin/umft \
  && chmod +x /usr/local/bin/umft /app/dist/cli.js \
  && chown -R umft:umft /app /home/umft
USER umft
ENTRYPOINT ["umft"]
CMD ["--help"]
