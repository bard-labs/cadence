# Build from repo root (linux/amd64 for the home server):
#   docker build --platform linux/amd64 -f apps/web/Dockerfile -t cadence-web:prod .
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/protocol/package.json packages/protocol/
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/protocol packages/protocol
COPY apps/web apps/web

ARG NEXT_PUBLIC_API_URL=https://cadence.bardiamardan.xyz
ARG NEXT_PUBLIC_WS_URL=wss://cadence.bardiamardan.xyz/ws
ARG NEXT_PUBLIC_MEDIA_URL=https://cadence.bardiamardan.xyz
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_MEDIA_URL=$NEXT_PUBLIC_MEDIA_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @bardlabs/cadence-web build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S cadence && adduser -S cadence -G cadence
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER cadence
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
