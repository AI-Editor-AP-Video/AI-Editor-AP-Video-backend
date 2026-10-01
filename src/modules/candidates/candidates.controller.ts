import type { FastifyInstance } from "fastify";
import { candidatesService } from "./candidates.service.js";
import {
  ListCandidatesQuerySchema,
  TrimCandidateSchema,
  ReAnalyzeCandidateSchema,
  ExportClipSchema,
} from "./candidates.schema.js";
import { validateSchema } from "../../middleware/validateRequest.js";

export async function candidatesRoutes(fastify: FastifyInstance) {
  // Query candidate clips filtered by AP-Score, topic, discourse type
  fastify.get(
    "/api/candidates",
    { preHandler: validateSchema({ query: ListCandidatesQuerySchema }) },
    async (req) => {
      return candidatesService.listCandidates(req.query as any);
    }
  );

  // Get deep-dive details for a specific candidate
  fastify.get("/api/candidates/:id", async (req) => {
    const { id } = req.params as { id: string };
    return candidatesService.getCandidateById(id);
  });

  // Adjust trim start & end timestamps in Editorial Review Studio
  fastify.patch(
    "/api/candidates/:id/trim",
    { preHandler: validateSchema({ body: TrimCandidateSchema }) },
    async (req) => {
      const { id } = req.params as { id: string };
      return candidatesService.trimCandidateBounds(id, req.body as any);
    }
  );

  // Trigger LLM re-analysis with custom editorial prompt
  fastify.post(
    "/api/candidates/:id/re-analyze",
    { preHandler: validateSchema({ body: ReAnalyzeCandidateSchema }) },
    async (req) => {
      const { id } = req.params as { id: string };
      return candidatesService.reAnalyzeCandidate(id, req.body as any);
    }
  );

  // Trigger social media rendering / export (Shorts / Reels / YouTube)
  fastify.post(
    "/api/candidates/:id/export",
    { preHandler: validateSchema({ body: ExportClipSchema }) },
    async (req) => {
      const { id } = req.params as { id: string };
      return candidatesService.exportClip(id, req.body as any);
    }
  );

  // Phase 3: Get or generate timeline augmentation recommendations
  fastify.post("/api/candidates/:id/timeline-recommendations", async (req) => {
    const { id } = req.params as { id: string };
    return candidatesService.getTimelineRecommendations(id);
  });
}
