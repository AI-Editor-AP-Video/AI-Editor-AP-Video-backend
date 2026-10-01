# Backend — Acharya Prashant Editorial Studio Gateway

> **Framework**: Node.js, Fastify v5, TypeScript, Prisma ORM, Better-Auth  
> **Documentation**: [Complete Backend Architecture Guide (v1)](../docs/v1/BACKEND.md)  

## Getting Started

```bash
# Install dependencies
pnpm install

# Push Prisma schema to PostgreSQL
npx prisma db push

# Generate Prisma Client
npx prisma generate

# Start API server in development
pnpm dev:api

# Start standalone BullMQ worker in development
pnpm dev:worker

# Build and start in production
pnpm build
pnpm start:api      # Starts HTTP API Server
pnpm start:worker   # Starts Dedicated BullMQ Worker
```

## Production Docker Deployment

Deploy both the HTTP API server and standalone background worker with Docker Compose:

```bash
# Build and launch both API and Worker containers
docker compose -f docker-compose.prod.yml up -d --build

# Monitor live worker logs
docker compose -f docker-compose.prod.yml logs -f backend-worker

# Scale worker instances horizontally
docker compose -f docker-compose.prod.yml up -d --scale backend-worker=2
```

## Features
- **Single Source of Truth (SSoT)**: PostgreSQL + pgvector database migrations managed exclusively by Prisma.
- **Better-Auth & RBAC**: Salted PBKDF2 authentication with 100,000 iterations and role enforcement.
- **WebSocket Telemetry Hub**: Subscribes to Redis Pub/Sub channels and broadcasts live progress to editorial clients.
- **AI Microservice Interop**: Dispatches async jobs to the Python AI Engine on port 8002 and processes webhook callbacks.

Refer to [`docs/v1/BACKEND.md`](../docs/v1/BACKEND.md) for full technical documentation.
