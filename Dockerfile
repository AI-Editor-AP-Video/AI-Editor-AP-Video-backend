# Multi-stage Dockerfile for Node.js Backend with Prisma
FROM node:20-slim AS builder

WORKDIR /app

# Install OpenSSL required by Prisma query engine
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm prisma generate

COPY tsconfig.json ./
COPY src ./src/

RUN pnpm build

# Prune devDependencies while keeping generated Prisma client
RUN pnpm prune --prod --ignore-scripts

# Production Runner Stage
FROM node:20-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1536"

# Install OpenSSL, curl, and dumb-init
RUN apt-get update -y && apt-get install -y openssl curl dumb-init && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY prisma ./prisma/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/server.js"]
