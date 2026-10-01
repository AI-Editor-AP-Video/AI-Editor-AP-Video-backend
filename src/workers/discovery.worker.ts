import type { Job } from "bullmq";
import { aiServiceClient } from "../infrastructure/ai-client/ai-service-client.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { cacheService } from "../infrastructure/cache/cache.service.js";
import type { LaunchDiscoveryInput } from "../modules/discovery/discovery.schema.js";

export interface DiscoveryJobPayload {
  runId: string;
  sessionId: string;
  input: LaunchDiscoveryInput;
}

/**
 * Worker processor for Phase 2: Multi-Theme AI Candidate Discovery & Scoring
 */
export async function processDiscoveryJob(job: Job<DiscoveryJobPayload>) {
  const { runId, sessionId, input } = job.data;

  await job.updateProgress(15);

  try {
    let effectiveFocus = input.focusOptions || [];
    if (input.mode === "COMPREHENSIVE") {
      effectiveFocus = ["qa", "gita", "stories", "fear", "action", "relationships"];
    }

    // 1. Dispatch discovery prompt and parameter trees to Python AI Service
    const aiResponse = await aiServiceClient.triggerDiscovery(
      sessionId,
      runId,
      input.mode,
      effectiveFocus,
      input.customPrompt,
      input.formatPreset,
      input.targetLanguage,
      input.minDuration,
      input.maxDuration,
      input.maxCandidates
    );

    await job.updateProgress(75);

    // Invalidate caches
    await cacheService.del(`session:meta:${sessionId}`);
    await cacheService.delByPattern("sessions:list:*");
    await cacheService.delByPattern("candidates:list:*");

    await job.updateProgress(100);

    return {
      success: true,
      runId,
      sessionId,
      status: aiResponse.status,
      message: aiResponse.message,
    };
  } catch (err: any) {
    await prisma.discoveryRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        progressPercent: 0,
      },
    }).catch(() => {});

    await cacheService.del(`session:meta:${sessionId}`);
    await cacheService.delByPattern("sessions:list:*");

    throw new Error(`Discovery run failed: ${err.message || err}`);
  }
}
