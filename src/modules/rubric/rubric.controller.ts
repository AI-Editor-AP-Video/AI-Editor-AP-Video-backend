import type { FastifyInstance } from "fastify";
import { rubricService } from "./rubric.service.js";

export async function rubricRoutes(fastify: FastifyInstance) {
  // Get all active 7 AP Rubric criteria & veto rules
  fastify.get("/api/rubric", async () => {
    return rubricService.getRubricCriteria();
  });

  // Update rubric criterion weight or threshold
  fastify.patch("/api/rubric/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    return rubricService.updateRubricCriterion(id, body);
  });
}
