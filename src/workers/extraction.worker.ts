import type { Job } from "bullmq";
import { aiServiceClient } from "../infrastructure/ai-client/ai-service-client.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { cacheService } from "../infrastructure/cache/cache.service.js";

export interface ExtractionJobPayload {
  sessionId: string;
  videoPath: string;
  title: string;
}

/**
 * Worker processor for Phase 1: Heavy Video Extraction & Whisper Vector Indexing
 */
export async function processExtractionJob(job: Job<ExtractionJobPayload>) {
  const { sessionId, videoPath, title } = job.data;

  console.log(`[ExtractionWorker] Starting Phase 1 extraction job for session ${sessionId}...`);
  await job.updateProgress(10);

  // 1. Mark session as extracting in database (if not already completed/locked)
  const current = await prisma.videoSession.findUnique({
    where: { id: sessionId },
    select: { extractionStatus: true },
  });

  if (current?.extractionStatus === "LOCKED_AND_INDEXED") {
    console.log(`[ExtractionWorker] Session ${sessionId} is already LOCKED_AND_INDEXED. Skipping redundant extraction.`);
    await job.updateProgress(100);
    return { success: true, sessionId, status: "ALREADY_LOCKED" };
  }

  await prisma.videoSession.update({
    where: { id: sessionId },
    data: {
      extractionStatus: "EXTRACTING_MEDIA",
      extractionProgress: 10,
    },
  });
  await cacheService.del(`session:meta:${sessionId}`);
  await cacheService.delByPattern("sessions:list:*");

  await job.updateProgress(25);

  try {
    // 2. Dispatch to Python AI Microservice / Modal GPU
    console.log(`[ExtractionWorker] Dispatching extraction to AI Service for session ${sessionId} (path: ${videoPath})...`);
    const result = await aiServiceClient.triggerExtraction(sessionId, videoPath, title);
    console.log(`[ExtractionWorker] AI Service accepted extraction for session ${sessionId}:`, result);

    await job.updateProgress(100);

    // Invalidate caches
    await cacheService.del(`session:meta:${sessionId}`);
    await cacheService.delByPattern("sessions:list:*");

    return {
      success: true,
      sessionId,
      result,
    };
  } catch (err: any) {
    console.error(`[ExtractionWorker] AI Service extraction dispatch failed for ${sessionId}:`, err.message || err);
    await prisma.videoSession.update({
      where: { id: sessionId },
      data: {
        extractionStatus: "FAILED",
        extractionProgress: 0,
      },
    }).catch(() => {});

    await cacheService.del(`session:meta:${sessionId}`);
    await cacheService.delByPattern("sessions:list:*");

    throw new Error(`Extraction failed for session ${sessionId}: ${err.message || err}`);
  }
}
