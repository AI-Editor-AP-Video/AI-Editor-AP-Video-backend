import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { env } from "./config/env.js";
import { globalErrorHandler } from "./middleware/errorHandler.js";
import { wsHub } from "./infrastructure/websocket/ws-hub.js";

// Domain Module Routes
import { authRoutes } from "./modules/auth/auth.controller.js";
import { sessionsRoutes } from "./modules/sessions/sessions.controller.js";
import { extractionRoutes } from "./modules/extraction/extraction.controller.js";
import { discoveryRoutes } from "./modules/discovery/discovery.controller.js";
import { candidatesRoutes } from "./modules/candidates/candidates.controller.js";
import { rubricRoutes } from "./modules/rubric/rubric.controller.js";
import { decisionsRoutes } from "./modules/decisions/decisions.controller.js";
import { searchRoutes } from "./modules/search/search.controller.js";

export async function buildApp() {
  const server = Fastify({
    logger: env.NODE_ENV === "development" ? { level: "info" } : { level: "warn" },
  });

  // Ensure uploads directory exists (use /tmp/uploads on Vercel Serverless)
  const uploadsDir = process.env.VERCEL
    ? path.join("/tmp", "uploads")
    : path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // 1. Global Plugins
  await server.register(cors, {
    origin: (origin, cb) => {
      if (!origin || env.NODE_ENV === "development") {
        return cb(null, true);
      }
      const allowed = [
        env.FRONTEND_URL,
        "http://localhost:3000",
        "http://localhost:3001",
      ];
      if (
        allowed.includes(origin) ||
        origin.endsWith(".vercel.app") ||
        origin.endsWith(".pages.dev")
      ) {
        return cb(null, true);
      }
      return cb(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // Register WebSocket support only in persistent server mode
  if (!process.env.VERCEL) {
    await server.register(websocket);
  }

  await server.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024 * 1024, // 10 GB for long-form 4K video discourses
      files: 1,
    },
  });

  await server.register(fastifyStatic, {
    root: uploadsDir,
    prefix: "/static/media/",
    acceptRanges: true, // HTTP 206 Range requests for seamless video scrubbing
    decorateReply: true,
  });

  await server.register(fastifyStatic, {
    root: uploadsDir,
    prefix: "/api/static/media/",
    acceptRanges: true,
    decorateReply: false,
  });

  // 2. Global Error Handler
  server.setErrorHandler(globalErrorHandler);

  // 3. Register Domain Modules
  await server.register(authRoutes);
  await server.register(sessionsRoutes);
  await server.register(extractionRoutes);
  await server.register(discoveryRoutes);
  await server.register(candidatesRoutes);
  await server.register(rubricRoutes);
  await server.register(decisionsRoutes);
  await server.register(searchRoutes);

  // 4. Real-time WebSocket Telemetry Route
  if (!process.env.VERCEL) {
    server.get("/ws/sessions/:id", { websocket: true }, (socket, req) => {
      const { id: sessionId } = req.params as { id: string };
      server.log.info(`WebSocket telemetry subscriber connected for session: ${sessionId}`);

      wsHub.registerConnection(sessionId, socket);

      socket.on("close", () => {
        server.log.info(`WebSocket telemetry subscriber disconnected for session: ${sessionId}`);
      });
    });
  }

  // 5. Internal AI Microservice Webhook Callback
  server.post("/api/internal/ai-callback", async (req, reply) => {
    const payload = req.body as {
      session_id: string;
      step: string;
      status: string;
      progress?: number;
      message?: string;
    };

    server.log.info({ payload }, "Received internal callback from Python AI engine");

    // Broadcast to connected WebSocket clients if in persistent mode
    if (!process.env.VERCEL) {
      wsHub.broadcastToSession(payload.session_id, {
        type: "AI_CALLBACK",
        ...payload,
        timestamp: new Date().toISOString(),
      });
    }

    return { received: true };
  });

  // 6. System Health Check
  server.get("/health", async () => {
    return {
      status: "HEALTHY",
      service: "ap-editorial-backend",
      version: "2.0.0",
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    };
  });

  server.get("/api/health", async () => {
    return {
      status: "HEALTHY",
      service: "ap-editorial-backend",
      version: "2.0.0",
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    };
  });

  return server;
}

// 7. Start Standalone HTTP Server (Localhost, Docker, Cloud Run)
if (!process.env.VERCEL) {
  try {
    const server = await buildApp();
    await server.listen({ port: env.PORT, host: env.HOST });
    console.log(`🚀 Production-grade AP Editorial Backend live on http://localhost:${env.PORT}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
