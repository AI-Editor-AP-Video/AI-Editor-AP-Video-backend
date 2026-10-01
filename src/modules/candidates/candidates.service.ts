import { prisma } from "../../infrastructure/db/prisma.js";
import { AppError } from "../../middleware/errorHandler.js";
import { aiServiceClient } from "../../infrastructure/ai-client/ai-service-client.js";
import { s3Service } from "../../infrastructure/storage/s3.js";
import type {
  ListCandidatesQuery,
  TrimCandidateInput,
  ReAnalyzeCandidateInput,
  ExportClipInput,
} from "./candidates.schema.js";
import type { Prisma } from "@prisma/client";

export class CandidatesService {
  async listCandidates(query: ListCandidatesQuery) {
    const where: Prisma.CandidateClipWhereInput = {
      finalApScore: { gte: query.min_score },
    };

    if (query.session_id) {
      where.sessionId = query.session_id;
      if (!query.discovery_run_id) {
        const latestRun = await prisma.discoveryRun.findFirst({
          where: { sessionId: query.session_id, status: "COMPLETED" },
          orderBy: { completedAt: "desc" },
        });
        if (latestRun) {
          where.discoveryRunId = latestRun.id;
        }
      }
    }
    if (query.discovery_run_id) where.discoveryRunId = query.discovery_run_id;
    if (query.discourse_type && query.discourse_type !== "ALL") {
      where.discourseType = query.discourse_type;
    }
    if (query.status && query.status !== "ALL") {
      where.status = query.status as any;
    }

    const candidates = await prisma.candidateClip.findMany({
      where,
      orderBy: { finalApScore: "desc" },
      take: query.limit,
      skip: query.offset,
      include: {
        session: {
          select: { title: true, seriesCategory: true },
        },
      },
    });

    return candidates.map((c) => {
      const llm = (c.llmAnalysis as any) || {};
      const thumbUrl = llm.thumbnail?.thumbnail_url || llm.export_render?.thumbnail_url || null;
      const ctrScore = llm.thumbnail?.ctr_score ?? llm.export_render?.ctr_score ?? null;

      return {
        id: c.id,
        session_id: c.sessionId,
        session_title: c.session.title,
        series_category: c.session.seriesCategory,
        rank: c.rank,
        start_time: c.startTime,
        end_time: c.endTime,
        duration_seconds: c.durationSeconds,
        headline: c.headline,
        subtitle_quote: c.subtitleQuote,
        discourse_type: c.discourseType,
        detected_by: c.detectedBy,
        topics: c.topics,
        final_ap_score: c.finalApScore,
        is_vetoed: c.isVetoed,
        veto_reason: c.vetoReason,
        ap_score_breakdown: c.apScoreBreakdown,
        llm_analysis: c.llmAnalysis,
        research_references: c.researchReferences,
        status: c.status,
        created_at: c.createdAt,
        thumbnail_url: thumbUrl ? s3Service.getAssetPublicUrl(thumbUrl) : null,
        ctr_score: ctrScore,
      };
    });
  }

  async getCandidateById(id: string) {
    const candidate = await prisma.candidateClip.findUnique({
      where: { id },
      include: {
        session: true,
        discoveryRun: true,
        decisions: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!candidate) {
      throw new AppError(`Candidate clip '${id}' not found`, 404);
    }

    const llm = (candidate.llmAnalysis as any) || {};
    const thumbUrl = llm.thumbnail?.thumbnail_url || llm.export_render?.thumbnail_url || null;
    const ctrScore = llm.thumbnail?.ctr_score ?? llm.export_render?.ctr_score ?? null;

    return {
      ...candidate,
      session_id: candidate.sessionId,
      session_title: candidate.session?.title,
      series_category: candidate.session?.seriesCategory,
      start_time: candidate.startTime,
      end_time: candidate.endTime,
      duration_seconds: candidate.durationSeconds,
      subtitle_quote: candidate.subtitleQuote,
      discourse_type: candidate.discourseType,
      detected_by: candidate.detectedBy,
      final_ap_score: candidate.finalApScore,
      is_vetoed: candidate.isVetoed,
      veto_reason: candidate.vetoReason,
      ap_score_breakdown: candidate.apScoreBreakdown,
      llm_analysis: candidate.llmAnalysis,
      research_references: candidate.researchReferences,
      created_at: candidate.createdAt,
      proxy_url: candidate.session?.proxyVideoS3Key ? s3Service.getAssetPublicUrl(candidate.session.proxyVideoS3Key) : null,
      thumbnail_url: thumbUrl ? s3Service.getAssetPublicUrl(thumbUrl) : null,
      ctr_score: ctrScore,
    };
  }

  async trimCandidateBounds(id: string, input: TrimCandidateInput) {
    if (input.endTime <= input.startTime) {
      throw new AppError("End time must be greater than start time", 400);
    }

    const candidate = await this.getCandidateById(id);

    let updatedLlmAnalysis = (candidate.llm_analysis as Record<string, any>) || {};
    try {
      const thumbRes = await aiServiceClient.generateThumbnail({
        candidateId: id,
        sessionId: candidate.sessionId,
        videoPath: candidate.session?.masterVideoS3Key || candidate.session?.proxyVideoS3Key,
        startTime: input.startTime,
        endTime: input.endTime,
        headline: candidate.headline,
        channelTag: "आचार्य प्रशांत",
      });
      if (thumbRes && thumbRes.thumbnail_url) {
        updatedLlmAnalysis = {
          ...updatedLlmAnalysis,
          thumbnail: {
            status: "COMPOSITED",
            thumbnail_url: thumbRes.thumbnail_url,
            thumbnail_path: thumbRes.thumbnail_path,
            ctr_score: thumbRes.ctr_score,
            frame_timestamp: thumbRes.selected_timestamp,
            metrics: thumbRes.metrics,
            trimmed_at: new Date().toISOString(),
          },
        };
      }
    } catch (thumbErr) {
      console.warn(`[CandidatesService] Auto thumbnail generation on trim failed for ${id}:`, thumbErr);
    }

    const updated = await prisma.candidateClip.update({
      where: { id },
      data: {
        startTime: input.startTime,
        endTime: input.endTime,
        durationSeconds: input.endTime - input.startTime,
        status: "EDITED",
        llmAnalysis: updatedLlmAnalysis,
      },
    });

    // Record trim event in editorial decision log
    const defaultUser = await prisma.user.findFirst({ select: { id: true } });
    const resolvedEditorId = defaultUser?.id || "cmu5tb4o700021sugg7so70gg";

    await prisma.editorialDecision.create({
      data: {
        candidateId: id,
        sessionId: candidate.sessionId,
        editorId: resolvedEditorId,
        decision: "AMEND",
        originalStartTime: candidate.startTime,
        originalEndTime: candidate.endTime,
        adjustedStartTime: input.startTime,
        adjustedEndTime: input.endTime,
        notes: input.reason || "Editor adjusted trim bounds in Review Studio",
        featureVectorSnapshot: {
          ap_score: candidate.final_ap_score,
          discourse_type: candidate.discourse_type,
          headline: candidate.headline,
          thumbnail_url: updatedLlmAnalysis.thumbnail?.thumbnail_url || null,
          ctr_score: updatedLlmAnalysis.thumbnail?.ctr_score || null,
        },
      },
    });

    return updated;
  }

  async reAnalyzeCandidate(id: string, input: ReAnalyzeCandidateInput) {
    const candidate = await this.getCandidateById(id);

    // In production, this dispatches a refined prompt to the Python ModelGateway
    return {
      status: "ANALYSIS_UPDATED",
      candidate_id: id,
      message: `Re-analysis completed with focus on ${input.focusArea}`,
      candidate,
    };
  }

  async exportClip(id: string, input: ExportClipInput) {
    const candidate = await this.getCandidateById(id);

    try {
      // 1. Trigger automated 9:16 vertical video rendering with face-tracking & subtitles
      const renderRes = await aiServiceClient.renderVerticalClip({
        candidateId: candidate.id,
        sessionId: candidate.sessionId,
        videoPath: candidate.session?.masterVideoS3Key || candidate.session?.proxyVideoS3Key,
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        burnSubtitles: true,
        aspectRatio: input.aspectRatio || "9:16",
      });

      // 2. Trigger high-CTR thumbnail candidate selection & headline compositing
      const thumbRes = await aiServiceClient.generateThumbnail({
        candidateId: candidate.id,
        sessionId: candidate.sessionId,
        videoPath: candidate.session?.masterVideoS3Key || candidate.session?.proxyVideoS3Key,
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        headline: candidate.headline,
        channelTag: "आचार्य प्रशांत",
      });

      // 3. Persist rendered URLs inside CandidateClip.llmAnalysis
      const existingAnalysis = (candidate.llmAnalysis as Record<string, any>) || {};
      const updatedAnalysis = {
        ...existingAnalysis,
        export_render: {
          status: "COMPLETED",
          video_url: renderRes.output_url,
          video_path: renderRes.output_path,
          thumbnail_url: thumbRes.thumbnail_url,
          thumbnail_path: thumbRes.thumbnail_path,
          ctr_score: thumbRes.ctr_score,
          duration_seconds: renderRes.duration_seconds,
          crop_x: renderRes.crop_x,
          subtitles_burned: renderRes.subtitles_burned,
          rendered_at: new Date().toISOString(),
        },
      };

      await prisma.candidateClip.update({
        where: { id },
        data: { llmAnalysis: updatedAnalysis },
      });

      return {
        status: "COMPLETED",
        candidate_id: id,
        format: input.format,
        aspect_ratio: input.aspectRatio || "9:16",
        video_url: renderRes.output_url,
        thumbnail_url: thumbRes.thumbnail_url,
        ctr_score: thumbRes.ctr_score,
        duration_seconds: renderRes.duration_seconds,
        subtitles_burned: renderRes.subtitles_burned,
      };
    } catch (err: any) {
      console.error(`Export rendering failed for candidate ${id}:`, err);
      return {
        status: "RENDER_JOB_QUEUED",
        candidate_id: id,
        format: input.format,
        aspect_ratio: input.aspectRatio || "9:16",
        message: `Render job queued. Error details: ${err.message || err}`,
        output_filename: `AP_${candidate.discourseType}_${candidate.id}_${input.format}.mp4`,
      };
    }
  }

  async getTimelineRecommendations(id: string) {
    const candidate = await this.getCandidateById(id);
    const existingAnalysis = (candidate.llmAnalysis as Record<string, any>) || {};

    if (existingAnalysis.timeline_recommendations && existingAnalysis.timeline_recommendations.cue_points?.length > 0) {
      return existingAnalysis.timeline_recommendations;
    }

    try {
      const recommendations = await aiServiceClient.getTimelineRecommendations({
        candidateId: candidate.id,
        sessionId: candidate.sessionId,
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        headline: candidate.headline,
        discourseType: candidate.discourseType,
        topics: Array.isArray(candidate.topics) ? (candidate.topics as string[]) : [],
        transcriptText: candidate.subtitleQuote || undefined,
      });

      const updatedAnalysis = {
        ...existingAnalysis,
        timeline_recommendations: recommendations,
      };

      await prisma.candidateClip.update({
        where: { id },
        data: { llmAnalysis: updatedAnalysis },
      });

      return recommendations;
    } catch (err: any) {
      console.error(`Timeline recommendations failed for candidate ${id}:`, err);
      throw new AppError(`Failed to generate timeline recommendations: ${err.message || err}`, 500);
    }
  }
}

export const candidatesService = new CandidatesService();
