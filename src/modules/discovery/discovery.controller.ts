import type { FastifyInstance } from "fastify";
import { discoveryService } from "./discovery.service.js";
import { LaunchDiscoverySchema } from "./discovery.schema.js";
import { validateSchema } from "../../middleware/validateRequest.js";

export async function discoveryRoutes(fastify: FastifyInstance) {
  // Launch Phase 2 AI Discovery Run
  fastify.post(
    "/api/sessions/:id/discovery",
    { preHandler: validateSchema({ body: LaunchDiscoverySchema }) },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const run = await discoveryService.launchDiscoveryRun(id, req.body as any);
      reply.status(202);
      return run;
    }
  );

  // List historical discovery runs for a session
  fastify.get("/api/sessions/:id/discovery/runs", async (req) => {
    const { id } = req.params as { id: string };
    return discoveryService.listRunsForSession(id);
  });

  // Get status of a specific discovery run
  fastify.get("/api/discovery/runs/:runId", async (req) => {
    const { runId } = req.params as { runId: string };
    return discoveryService.getRunById(runId);
  });
}
