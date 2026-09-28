import type { FastifyInstance } from "fastify";
import { extractionService } from "./extraction.service.js";

export async function extractionRoutes(fastify: FastifyInstance) {
  // Trigger Phase 1: Ingestion & Data Extraction (Fails if already completed)
  fastify.post("/api/sessions/:id/extract", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body as { videoPath?: string }) || {};
    const result = await extractionService.triggerExtraction(id, body.videoPath);
    reply.status(202);
    return result;
  });

  // Get Phase 1 Extraction live status & lock state
  fastify.get("/api/sessions/:id/extraction/status", async (req) => {
    const { id } = req.params as { id: string };
    return extractionService.getExtractionStatus(id);
  });
}
