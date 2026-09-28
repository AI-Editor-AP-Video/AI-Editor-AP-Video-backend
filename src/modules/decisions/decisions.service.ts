import { prisma } from "../../infrastructure/db/prisma.js";
import { AppError } from "../../middleware/errorHandler.js";
import { aiServiceClient } from "../../infrastructure/ai-client/ai-service-client.js";

export interface SubmitFeedbackInput {
  candidate_id: string;
  session_id: string;
  decision: "ACCEPT" | "REJECT" | "AMEND";
  editor_id?: string;
  adjusted_start_time?: number;
  adjusted_end_time?: number;
  rejection_reason?: string;
  notes?: string;
}

export class DecisionsService {
  async submitFeedback(input: SubmitFeedbackInput) {
    const candidate = await prisma.candidateClip.findUnique({
      where: { id: input.candidate_id },
      include: {
        session: true,
      },
    });

    if (!candidate) {
      throw new AppError(`Candidate clip '${input.candidate_id}' not found`, 404);
    }

    // Map decision to candidate status
    const statusMap = {
      ACCEPT: "APPROVED",
      REJECT: "REJECTED",
      AMEND: "EDITED",
    } as const;

    const newStatus = statusMap[input.decision];

    let updatedLlmAnalysis = (candidate.llmAnalysis as Record<string, any>) || {};
    const isTrimmed =
      (input.adjusted_start_time !== undefined && input.adjusted_start_time !== candidate.startTime) ||
      (input.adjusted_end_time !== undefined && input.adjusted_end_time !== candidate.endTime);
    const existingThumb =
      updatedLlmAnalysis.thumbnail?.thumbnail_url || updatedLlmAnalysis.export_render?.thumbnail_url;

    // Feature: Auto-generate & attach High-CTR thumbnail when clip is approved (or re-trim approved)
    if (input.decision === "ACCEPT" && (!existingThumb || isTrimmed)) {
      try {
        const effectiveStartTime = input.adjusted_start_time ?? candidate.startTime;
        const effectiveEndTime = input.adjusted_end_time ?? candidate.endTime;
        const videoPath = candidate.session?.masterVideoS3Key || candidate.session?.proxyVideoS3Key;

        const thumbRes = await aiServiceClient.generateThumbnail({
          candidateId: candidate.id,
          sessionId: candidate.sessionId,
          videoPath,
          startTime: effectiveStartTime,
          endTime: effectiveEndTime,
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
              approved_at: new Date().toISOString(),
            },
          };
        }
      } catch (thumbErr) {
        console.warn(`[DecisionsService] Auto thumbnail generation on approval failed for ${candidate.id}:`, thumbErr);
      }
    }

    // Update candidate record
    const updatedCandidate = await prisma.candidateClip.update({
      where: { id: input.candidate_id },
      data: {
        status: newStatus,
        startTime: input.adjusted_start_time ?? candidate.startTime,
        endTime: input.adjusted_end_time ?? candidate.endTime,
        durationSeconds:
          input.adjusted_start_time !== undefined && input.adjusted_end_time !== undefined
            ? input.adjusted_end_time - input.adjusted_start_time
            : candidate.durationSeconds,
        llmAnalysis: updatedLlmAnalysis,
      },
    });

    // Resolve valid editorId from database
    const defaultUser = await prisma.user.findFirst({ select: { id: true } });
    const resolvedEditorId = input.editor_id || defaultUser?.id || "cmu5tb4o700021sugg7so70gg";

    // Record decision log with feature vector snapshot for flywheel dataset
    const decisionLog = await prisma.editorialDecision.create({
      data: {
        candidateId: input.candidate_id,
        sessionId: input.session_id,
        editorId: resolvedEditorId,
        decision: input.decision,
        originalStartTime: candidate.startTime,
        originalEndTime: candidate.endTime,
        adjustedStartTime: input.adjusted_start_time,
        adjustedEndTime: input.adjusted_end_time,
        rejectionReason: input.rejection_reason,
        notes: input.notes,
        featureVectorSnapshot: {
          ap_score: candidate.finalApScore,
          discourse_type: candidate.discourseType,
          breakdown: candidate.apScoreBreakdown,
          headline: candidate.headline,
          thumbnail_url: updatedLlmAnalysis.thumbnail?.thumbnail_url || null,
          ctr_score: updatedLlmAnalysis.thumbnail?.ctr_score || null,
        },
      },
    });

    return {
      status: "SUCCESS",
      decision_id: decisionLog.id,
      candidate_status: newStatus,
      thumbnail_url: updatedLlmAnalysis.thumbnail?.thumbnail_url || null,
      ctr_score: updatedLlmAnalysis.thumbnail?.ctr_score || null,
      candidate: updatedCandidate,
      decision: decisionLog,
    };
  }

  async listDecisions(query: { session_id?: string; decision?: string; limit?: number }) {
    const where: any = {};
    if (query.session_id) where.sessionId = query.session_id;
    if (query.decision && query.decision !== "ALL") where.decision = query.decision;

    const decisions = await prisma.editorialDecision.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit || 100,
      include: {
        candidate: {
          select: {
            headline: true,
            discourseType: true,
            finalApScore: true,
          },
        },
      },
    });

    return decisions.map((d) => ({
      id: d.id,
      candidate_id: d.candidateId,
      session_id: d.sessionId,
      editor_id: d.editorId,
      decision: d.decision,
      candidate_headline: d.candidate?.headline,
      discourse_type: d.candidate?.discourseType,
      ap_score: d.candidate?.finalApScore,
      original_start_time: d.originalStartTime,
      original_end_time: d.originalEndTime,
      adjusted_start_time: d.adjustedStartTime,
      adjusted_end_time: d.adjustedEndTime,
      rejection_reason: d.rejectionReason,
      notes: d.notes,
      created_at: d.createdAt,
    }));
  }
}

export const decisionsService = new DecisionsService();
