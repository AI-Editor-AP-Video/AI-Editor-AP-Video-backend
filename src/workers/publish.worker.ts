import type { Job } from "bullmq";
import { prisma } from "../infrastructure/db/prisma.js";
import { cacheService } from "../infrastructure/cache/cache.service.js";

export interface PublishJobPayload {
  candidateId: string;
  sessionId: string;
  platforms: ("YOUTUBE_SHORTS" | "INSTAGRAM_REELS" | "TIKTOK" | "TWITTER")[];
  title?: string;
  description?: string;
  tags?: string[];
  scheduledPublishAt?: string;
}

/**
 * Worker processor for Phase 5: Social Media Publishing & Multi-Platform Export
 */
export async function processPublishJob(job: Job<PublishJobPayload>) {
  const { candidateId, sessionId, platforms, title, description, tags } = job.data;

  await job.updateProgress(10);

  const candidate = await prisma.candidateClip.findUnique({
    where: { id: candidateId },
    include: { session: true },
  });

  if (!candidate) {
    throw new Error(`Candidate clip '${candidateId}' not found for publishing`);
  }

  const existingAnalysis = (candidate.llmAnalysis as Record<string, any>) || {};
  const renderData = existingAnalysis.export_render;

  if (!renderData || renderData.status !== "COMPLETED") {
    throw new Error(`Candidate clip '${candidateId}' has not been rendered yet. Complete 9:16 vertical render before publishing.`);
  }

  await job.updateProgress(35);

  const publishedResults: Record<string, any> = {};

  try {
    for (const [index, platform] of platforms.entries()) {
      const stepProgress = 35 + Math.round(((index + 1) / platforms.length) * 50);
      await job.updateProgress(stepProgress);

      const postTitle = title || candidate.headline || "Acharya Prashant Discourse Highlight";
      const postTags = tags || ["AcharyaPrashant", "Vedanta", "Gita", "Shorts"];

      // Simulated multi-platform API publishing
      publishedResults[platform] = {
        platform,
        status: "PUBLISHED",
        title: postTitle,
        tags: postTags,
        video_url: renderData.video_url,
        published_at: new Date().toISOString(),
        external_id: `ext_${platform.toLowerCase()}_${Date.now()}`,
        view_url: `https://${platform.toLowerCase().replace("_", "")}.com/shorts/${candidateId}`,
      };
    }

    await job.updateProgress(90);

    // Persist social publication records in PostgreSQL
    const updatedAnalysis = {
      ...existingAnalysis,
      social_exports: {
        status: "PUBLISHED",
        platforms: publishedResults,
        last_published_at: new Date().toISOString(),
      },
    };

    await prisma.candidateClip.update({
      where: { id: candidateId },
      data: {
        status: "APPROVED",
        llmAnalysis: updatedAnalysis,
      },
    });

    // Invalidate caches
    await cacheService.del(`candidate:${candidateId}`);
    await cacheService.delByPattern("candidates:list:*");

    await job.updateProgress(100);

    return {
      success: true,
      candidateId,
      sessionId,
      publishedResults,
    };
  } catch (err: any) {
    console.error(`[PublishWorker] Failed publishing candidate ${candidateId}:`, err.message);

    await prisma.candidateClip.update({
      where: { id: candidateId },
      data: {
        llmAnalysis: {
          ...existingAnalysis,
          social_exports: {
            status: "FAILED",
            error: err.message || "Social publishing failed",
            failed_at: new Date().toISOString(),
          },
        },
      },
    }).catch(() => {});

    throw new Error(`Social publishing failed for candidate ${candidateId}: ${err.message || err}`);
  }
}
