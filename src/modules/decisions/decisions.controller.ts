import type { FastifyInstance } from "fastify";
import { decisionsService } from "./decisions.service.js";

export async function decisionsRoutes(fastify: FastifyInstance) {
  // Submit Human Editor decision (Accept / Reject / Amend)
  fastify.post("/api/feedback", async (req) => {
    return decisionsService.submitFeedback(req.body as any);
  });

  fastify.post("/api/decisions", async (req) => {
    return decisionsService.submitFeedback(req.body as any);
  });

  // Query historical editorial decisions audit trail
  fastify.get("/api/decisions", async (req) => {
    const query = req.query as any;
    return decisionsService.listDecisions(query);
  });
}
