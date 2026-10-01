import Fastify from "fastify";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { env } from "./config/env.js";
import { corsConfig } from "./config/cors.config.js";
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
import { mediaRoutes } from "./modules/media/media.controller.js";
import { initBackgroundWorkers, shutdownBackgroundWorkers } from "./infrastructure/queue/bootstrap.js";

export async function buildApp() {
  const server = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "warn" : "info",
    },
    // Disable noisy automatic request/response logging for routine polling & healthchecks
    disableRequestLogging: true,
    bodyLimit: 10 * 1024 * 1024 * 1024,
  });

  // Ensure uploads directory exists
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // 1. Global Plugins (Production-Grade CORS)
  await server.register(cors, corsConfig);

  // 2. High-Performance Brotli & Gzip Payload Compression (Reduces network payload sizes by 80%+)
  await server.register(compress, {
    threshold: 1024,
    encodings: ["br", "gzip", "deflate"],
  });

  // Register WebSocket support for real-time telemetry streaming
  await server.register(websocket);

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
  await server.register(mediaRoutes);

  // 4. Real-time WebSocket Telemetry Route
  server.get("/ws/sessions/:id", { websocket: true }, (socket, req) => {
    const { id: sessionId } = req.params as { id: string };
    server.log.info(`WebSocket telemetry subscriber connected for session: ${sessionId}`);

    wsHub.registerConnection(sessionId, socket);

    socket.on("close", () => {
      server.log.info(`WebSocket telemetry subscriber disconnected for session: ${sessionId}`);
    });
  });

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

    // Broadcast to connected WebSocket clients
    wsHub.broadcastToSession(payload.session_id, {
      type: "AI_CALLBACK",
      ...payload,
      timestamp: new Date().toISOString(),
    });

    // When Phase 1 extraction completes and assets are uploaded to R2, clean up staging files
    if (payload.step === "EXTRACTION" && payload.status === "COMPLETED") {
      try {
        if (fs.existsSync(uploadsDir)) {
          const files = fs.readdirSync(uploadsDir);
          for (const file of files) {
            if (file.startsWith(`${payload.session_id}_`) || file === payload.session_id) {
              const p = path.join(uploadsDir, file);
              fs.rmSync(p, { recursive: true, force: true });
              server.log.info(`[Uploads Cleanup] Purged local staging asset: ${file}`);
            }
          }
        }
      } catch (err) {
        server.log.warn({ err }, "[Uploads Cleanup] Warning during staging files cleanup");
      }

      // Schedule Redis ephemeral logs cleanup (expire in 2 hours since everything is indexed in DB)
      try {
        await wsHub.expireSessionKeys(payload.session_id, 7200);
      } catch (err) {
        server.log.warn({ err }, "[Redis Cleanup] Warning scheduling Redis logs expiration");
      }
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

  server.get("/.well-known/appspecific/com.chrome.devtools.json", async () => {
    return {};
  });

  return server;
}

// 7. Start Standalone HTTP Server (Localhost, Docker, EC2)
if (process.env.NODE_ENV !== "test") {
  try {
    const server = await buildApp();
    await server.listen({ port: env.PORT, host: "0.0.0.0" });
    console.log(`🚀 Production-grade AP Editorial API Server live on http://0.0.0.0:${env.PORT}`);

    // Run BullMQ background workers in-process by default (unless explicitly set to false for dedicated worker containers)
    const runInlineWorkers = process.env.START_WORKERS_INLINE !== "false";
    if (runInlineWorkers) {
      console.log("⚡ [Server] Running BullMQ workers in-process (inline mode active)...");
      initBackgroundWorkers();
    } else {
      console.log("ℹ️  [Server] Running in standalone API mode (external worker process expected)");
    }

    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
    for (const signal of signals) {
      process.on(signal, async () => {
        server.log.info(`Received ${signal}, closing server gracefully...`);
        if (runInlineWorkers) {
          await shutdownBackgroundWorkers();
        }
        await server.close();
        process.exit(0);
      });
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

