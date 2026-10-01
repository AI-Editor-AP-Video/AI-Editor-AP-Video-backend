import type { Job } from "bullmq";
import { aiServiceClient } from "../infrastructure/ai-client/ai-service-client.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { cacheService } from "../infrastructure/cache/cache.service.js";

export interface RenderJobPayload {
  candidateId: string;
  sessionId: string;
  videoPath?: string | null;
  startTime: number;
  endTime: number;
  aspectRatio?: string;
  burnSubtitles?: boolean;
  format?: string;
}

/**
 * Worker processor for Phase 3: 9:16 Vertical Video Re-framing & Subtitle Burn-in
 */
export async function processRenderJob(job: Job<RenderJobPayload>) {
  const { candidateId, sessionId, videoPath, startTime, endTime, aspectRatio, burnSubtitles, format } = job.data;

  await job.updateProgress(10);

  const candidate = await prisma.candidateClip.findUnique({
    where: { id: candidateId },
    include: { session: true },
  });

  if (!candidate) {
    throw new Error(`Candidate clip '${candidateId}' not found for rendering`);
  }

  const resolvedVideoPath = videoPath || candidate.session?.masterVideoS3Key || candidate.session?.proxyVideoS3Key;

  await job.updateProgress(25);

  try {
    // 1. Dispatch vertical video rendering & subtitle compositing to Python AI Engine / Modal GPU
    const renderRes = await aiServiceClient.renderVerticalClip({
      candidateId,
      sessionId,
      videoPath: resolvedVideoPath,
      startTime: startTime ?? candidate.startTime,
      endTime: endTime ?? candidate.endTime,
      burnSubtitles: burnSubtitles ?? true,
      aspectRatio: aspectRatio || "9:16",
    });

    await job.updateProgress(75);

    // 2. Persist rendered short asset metadata into PostgreSQL
    const existingAnalysis = (candidate.llmAnalysis as Record<string, any>) || {};
    const updatedAnalysis = {
      ...existingAnalysis,
      export_render: {
        status: "COMPLETED",
        video_url: renderRes.output_url,
        video_path: renderRes.output_path,
        duration_seconds: renderRes.duration_seconds,
        crop_x: renderRes.crop_x,
        subtitles_burned: renderRes.subtitles_burned,
        aspect_ratio: aspectRatio || "9:16",
        format: format || "YOUTUBE_SHORTS",
        rendered_at: new Date().toISOString(),
      },
    };

    await prisma.candidateClip.update({
      where: { id: candidateId },
      data: { llmAnalysis: updatedAnalysis },
    });

    // 3. Invalidate Redis caches
    await cacheService.del(`candidate:${candidateId}`);
    await cacheService.delByPattern("candidates:list:*");
    await cacheService.del(`session:meta:${sessionId}`);

    await job.updateProgress(100);

    return {
      success: true,
      candidateId,
      sessionId,
      videoUrl: renderRes.output_url,
      durationSeconds: renderRes.duration_seconds,
      subtitlesBurned: renderRes.subtitles_burned,
    };
  } catch (err: any) {
    console.error(`[RenderWorker] Failed rendering candidate ${candidateId}:`, err.message);

    const existingAnalysis = (candidate.llmAnalysis as Record<string, any>) || {};
    await prisma.candidateClip.update({
      where: { id: candidateId },
      data: {
        llmAnalysis: {
          ...existingAnalysis,
          export_render: {
            status: "FAILED",
            error: err.message || "Rendering failed",
            failed_at: new Date().toISOString(),
          },
        },
      },
    }).catch(() => {});

    throw new Error(`Vertical render failed for candidate ${candidateId}: ${err.message || err}`);
  }
}
