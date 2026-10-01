import type { FastifyInstance } from "fastify";
import { sessionsService } from "./sessions.service.js";
import {
  CreateSessionSchema,
  GenerateUploadUrlSchema,
  ListSessionsQuerySchema,
  InitiateMultipartSchema,
  GetPartUrlsSchema,
  CompleteMultipartSchema,
  AbortMultipartSchema,
} from "./sessions.schema.js";
import { validateSchema } from "../../middleware/validateRequest.js";

export async function sessionsRoutes(fastify: FastifyInstance) {
  // List all sessions with 3-stage lifecycle filter & search
  fastify.get(
    "/api/sessions",
    { preHandler: validateSchema({ query: ListSessionsQuerySchema }) },
    async (req) => {
      return sessionsService.listSessions(req.query as any);
    }
  );

  // Request direct S3 pre-signed upload URL (Single Part)
  fastify.post(
    "/api/sessions/upload-url",
    { preHandler: validateSchema({ body: GenerateUploadUrlSchema }) },
    async (req) => {
      return sessionsService.generateUploadUrl(req.body as any);
    }
  );

  // ── Parallel S3/R2 Multipart Upload Endpoints ──

  // 1. Initiate Multipart Upload Session
  fastify.post(
    "/api/sessions/multipart/initiate",
    { preHandler: validateSchema({ body: InitiateMultipartSchema }) },
    async (req) => {
      return sessionsService.initiateMultipartUpload(req.body as any);
    }
  );

  // 2. Request additional signed Part URLs on-demand
  fastify.post(
    "/api/sessions/multipart/part-urls",
    { preHandler: validateSchema({ body: GetPartUrlsSchema }) },
    async (req) => {
      return sessionsService.generatePartUrls(req.body as any);
    }
  );

  // 3. Complete and assemble Multipart Upload in R2
  fastify.post(
    "/api/sessions/multipart/complete",
    { preHandler: validateSchema({ body: CompleteMultipartSchema }) },
    async (req, reply) => {
      const result = await sessionsService.completeMultipartUpload(req.body as any);
      reply.status(201);
      return result;
    }
  );

  // 4. Abort incomplete Multipart Upload
  fastify.post(
    "/api/sessions/multipart/abort",
    { preHandler: validateSchema({ body: AbortMultipartSchema }) },
    async (req) => {
      return sessionsService.abortMultipartUpload(req.body as any);
    }
  );

  // Stream real video file upload and register session
  fastify.post("/api/sessions/upload", async (req, reply) => {
    const data = await req.file();
    if (!data) {
      reply.status(400);
      return { error: "BAD_REQUEST", message: "No video file attached in form data" };
    }

    const fields = (data.fields as Record<string, any>) || {};
    const query = (req.query as Record<string, any>) || {};
    const headerTitle = req.headers["x-session-title"]
      ? decodeURIComponent(req.headers["x-session-title"] as string)
      : "";

    const title =
      (typeof fields.title === "object" ? fields.title?.value : fields.title) ||
      query.title ||
      headerTitle ||
      "";

    const description =
      (typeof fields.description === "object" ? fields.description?.value : fields.description) ||
      query.description ||
      "";

    const seriesCategory =
      (typeof fields.seriesCategory === "object" ? fields.seriesCategory?.value : fields.seriesCategory) ||
      query.seriesCategory ||
      "Bhagavad Gita";

    const result = await sessionsService.uploadAndCreateSession(data, {
      title: title ? String(title).trim() : "",
      description: description ? String(description).trim() : "",
      seriesCategory: seriesCategory ? String(seriesCategory).trim() : "Bhagavad Gita",
    });

    reply.status(201);
    return result;
  });

  // Register session after video upload (JSON metadata)
  fastify.post(
    "/api/sessions",
    { preHandler: validateSchema({ body: CreateSessionSchema }) },
    async (req, reply) => {
      const created = await sessionsService.createSession(req.body as any);
      reply.status(201);
      return created;
    }
  );

  // Get session details
  fastify.get("/api/sessions/:id", async (req) => {
    const { id } = req.params as { id: string };
    return sessionsService.getSessionById(id);
  });

  // Get full transcript with word-level timestamps & speaker diarization
  fastify.get("/api/sessions/:id/transcript", async (req) => {
    const { id } = req.params as { id: string };
    return sessionsService.getTranscript(id);
  });

  // Get keyframe OCR & visual description gallery
  fastify.get("/api/sessions/:id/keyframes", async (req) => {
    const { id } = req.params as { id: string };
    return sessionsService.getKeyframes(id);
  });

  // Update session title and metadata
  fastify.patch("/api/sessions/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { title?: string; description?: string; seriesCategory?: string };
    return sessionsService.updateSession(id, body);
  });

  // Delete session and permanently purge all media files, proxies, keyframes, transcripts, and database records
  fastify.delete("/api/sessions/:id", async (req) => {
    const { id } = req.params as { id: string };
    return sessionsService.deleteSession(id);
  });
}
