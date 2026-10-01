import type { Job } from "bullmq";
import { aiServiceClient } from "../infrastructure/ai-client/ai-service-client.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { cacheService } from "../infrastructure/cache/cache.service.js";

export interface ThumbnailJobPayload {
  candidateId: string;
  sessionId: string;
  videoPath?: string | null;
  startTime: number;
  endTime: number;
  headline: string;
  channelTag?: string;
}

/**
 * Worker processor for Phase 4: High-CTR Keyframe & Hindi Typography Thumbnail Compositing
 */
export async function processThumbnailJob(job: Job<ThumbnailJobPayload>) {
  const { candidateId, sessionId, videoPath, startTime, endTime, headline, channelTag } = job.data;

  await job.updateProgress(15);

  const candidate = await prisma.candidateClip.findUnique({
    where: { id: candidateId },
    include: { session: true },
  });

  if (!candidate) {
    throw new Error(`Candidate clip '${candidateId}' not found for thumbnail generation`);
  }

  const resolvedVideoPath = videoPath || candidate.session?.masterVideoS3Key || candidate.session?.proxyVideoS3Key;

  await job.updateProgress(35);

  try {
    // 1. Dispatch Keyframe extraction & typography compositing to Python AI service
    const thumbRes = await aiServiceClient.generateThumbnail({
      candidateId,
      sessionId,
      videoPath: resolvedVideoPath,
      startTime: startTime ?? candidate.startTime,
      endTime: endTime ?? candidate.endTime,
      headline: headline || candidate.headline,
      channelTag: channelTag || "आचार्य प्रशांत",
    });

    await job.updateProgress(75);

    // 2. Persist thumbnail metadata into candidate llmAnalysis
    const existingAnalysis = (candidate.llmAnalysis as Record<string, any>) || {};
    const updatedAnalysis = {
      ...existingAnalysis,
      thumbnail: {
        status: "COMPOSITED",
        thumbnail_url: thumbRes.thumbnail_url,
        thumbnail_path: thumbRes.thumbnail_path,
        ctr_score: thumbRes.ctr_score,
        frame_timestamp: thumbRes.selected_timestamp,
        metrics: thumbRes.metrics,
        generated_at: new Date().toISOString(),
      },
    };

    await prisma.candidateClip.update({
      where: { id: candidateId },
      data: { llmAnalysis: updatedAnalysis },
    });

    // 3. Invalidate Redis cache
    await cacheService.del(`candidate:${candidateId}`);
    await cacheService.delByPattern("candidates:list:*");

    await job.updateProgress(100);

    return {
      success: true,
      candidateId,
      thumbnailUrl: thumbRes.thumbnail_url,
      ctrScore: thumbRes.ctr_score,
    };
  } catch (err: any) {
    console.error(`[ThumbnailWorker] Failed generating thumbnail for candidate ${candidateId}:`, err.message);

    const existingAnalysis = (candidate.llmAnalysis as Record<string, any>) || {};
    await prisma.candidateClip.update({
      where: { id: candidateId },
      data: {
        llmAnalysis: {
          ...existingAnalysis,
          thumbnail: {
            status: "FAILED",
            error: err.message || "Thumbnail generation failed",
            failed_at: new Date().toISOString(),
          },
        },
      },
    }).catch(() => {});

    throw new Error(`Thumbnail generation failed for candidate ${candidateId}: ${err.message || err}`);
  }
}
