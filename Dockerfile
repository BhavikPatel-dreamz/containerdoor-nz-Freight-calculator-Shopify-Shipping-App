# ContainerDoor OMS — production image (self-host / Docker, not Vercel).
# Build:  docker compose build
# Run:    docker compose up -d

FROM node:22-alpine AS builder
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY extensions ./extensions
COPY prisma ./prisma
COPY prisma.config.ts ./

# prisma.config.ts requires DATABASE_URL even for `prisma generate`
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm exec prisma generate && pnpm exec react-router build

FROM node:22-alpine AS runner
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app /app
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["web"]
