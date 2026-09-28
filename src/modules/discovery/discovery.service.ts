import { prisma } from "../../infrastructure/db/prisma.js";
import { aiServiceClient } from "../../infrastructure/ai-client/ai-service-client.js";
import { wsHub } from "../../infrastructure/websocket/ws-hub.js";
import { AppError } from "../../middleware/errorHandler.js";
import type { LaunchDiscoveryInput } from "./discovery.schema.js";

export class DiscoveryService {
  /**
   * Launch a new Phase 2 AI Discovery Run on a session
   * Requires Phase 1 Data Extraction to be completed
   */
  async launchDiscoveryRun(sessionId: string, input: LaunchDiscoveryInput) {
    const session = await prisma.videoSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new AppError(`Session '${sessionId}' not found`, 404);
    }

    const runId = `run_${Date.now()}`;

    // Clear any stale WebSocket progress logs from previous runs in Redis
    await wsHub.clearSessionLogs(sessionId);

    // Sanitize and validate inputs based on discovery mode
    let effectiveFocus = input.focusOptions || [];
    if (input.mode === "COMPREHENSIVE") {
      effectiveFocus = ["qa", "gita", "stories", "fear", "action", "relationships"];
    } else if (input.mode === "CUSTOM") {
      if (!input.customPrompt || !input.customPrompt.trim()) {
        throw new AppError("customPrompt is required when discovery mode is CUSTOM", 400);
      }
    } else if (input.mode === "FOCUSED") {
      if (!effectiveFocus.length) {
        throw new AppError("At least one focusOption is required when discovery mode is FOCUSED", 400);
      }
    }

    // Create DiscoveryRun record in database
    const discoveryRun = await prisma.discoveryRun.create({
      data: {
        id: runId,
        sessionId,
        mode: input.mode,
        focusOptions: effectiveFocus,
        customPrompt: input.customPrompt,
        status: "RUNNING",
        progressPercent: 12,
        candidatesFound: 0,
        logs: [
          { time: "00:01", message: `Discovery run initialized in ${input.mode} mode` },
          { 
            time: "00:02", 
            message: input.mode === "CUSTOM" 
              ? `Targeted query: "${input.customPrompt}"` 
              : `Active seed themes: ${effectiveFocus.join(", ")}` 
          },
        ],
      },
    });

    // Trigger Python AI service for candidate mining and AP Rubric scoring
    await aiServiceClient.triggerDiscovery(
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

    return discoveryRun;
  }

  async listRunsForSession(sessionId: string) {
    return prisma.discoveryRun.findMany({
      where: { sessionId },
      orderBy: { startedAt: "desc" },
      include: {
        _count: {
          select: { candidates: true },
        },
      },
    });
  }

  async getRunById(runId: string) {
    const run = await prisma.discoveryRun.findUnique({
      where: { id: runId },
      include: {
        candidates: {
          orderBy: { finalApScore: "desc" },
        },
      },
    });

    if (!run) {
      throw new AppError(`Discovery run '${runId}' not found`, 404);
    }

    return run;
  }
}

export const discoveryService = new DiscoveryService();
