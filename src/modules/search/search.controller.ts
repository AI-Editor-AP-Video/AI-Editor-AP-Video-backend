import type { FastifyInstance } from "fastify";
import { searchService } from "./search.service.js";

export async function searchRoutes(fastify: FastifyInstance) {
  // Execute hybrid semantic vector search on session discourse memory
  fastify.post("/api/search", async (req) => {
    return searchService.executeHybridSearch(req.body as any);
  });
}
