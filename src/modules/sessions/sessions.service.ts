import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { MultipartFile } from "@fastify/multipart";
import { sessionsRepository } from "./sessions.repository.js";
import { s3Service } from "../../infrastructure/storage/s3.js";
import { aiServiceClient } from "../../infrastructure/ai-client/ai-service-client.js";
import { AppError } from "../../middleware/errorHandler.js";
import type { CreateSessionInput, GenerateUploadUrlInput, ListSessionsQuery } from "./sessions.schema.js";
import type { Prisma } from "@prisma/client";

export class SessionsService {
  async uploadAndCreateSession(
    multipartFile: MultipartFile,
    metadata: { title?: string; description?: string; seriesCategory?: string }
  ) {
    const sessionId = `sess_${Date.now()}`;
    const uploadsDir = path.resolve(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const ext = path.extname(multipartFile.filename) || ".mp4";
    const masterFilename = `${sessionId}_master${ext}`;
    const targetFilePath = path.join(uploadsDir, masterFilename);

    // Stream uploaded video directly to disk storage
    const writeStream = fs.createWriteStream(targetFilePath);
    await pipeline(multipartFile.file, writeStream);

    const title =
      metadata.title?.trim() ||
      multipartFile.filename.replace(/\.[^/.]+$/, "").replace(/_/g, " ") ||
      "Acharya Prashant Discourse";

    // Create session in PostgreSQL
    const created = await sessionsRepository.create({
      id: sessionId,
      title,
      description: metadata.description || null,
      seriesCategory: metadata.seriesCategory || "Bhagavad Gita",
      durationSeconds: 0,
      masterVideoS3Key: targetFilePath,
      proxyVideoS3Key: `/static/media/${sessionId}_proxy.mp4`,
      audioTrackS3Key: `/static/media/${sessionId}_audio.wav`,
      extractionStatus: "EXTRACTING_MEDIA",
      extractionProgress: 10,
    });

    // Trigger Python AI Microservice Phase 1 Extraction asynchronously in background
    aiServiceClient.triggerExtraction(sessionId, targetFilePath, title).catch((err) => {
      console.warn("AI Engine extraction trigger warning (will proceed asynchronously):", err);
    });

    return {
      session: created,
      uploadStatus: "SUCCESS",
      sessionId,
      masterVideoPath: targetFilePath,
    };
  }
  async listSessions(query: ListSessionsQuery) {
    const where: Prisma.VideoSessionWhereInput = {};

    if (query.category && query.category !== "ALL") {
      where.seriesCategory = query.category;
    }

    if (query.search?.trim()) {
      where.OR = [
        { title: { contains: query.search, mode: "insensitive" } },
        { description: { contains: query.search, mode: "insensitive" } },
      ];
    }

    // 3-Stage Lifecycle filtering
    if (query.status === "PROCESSING") {
      where.extractionStatus = { not: "LOCKED_AND_INDEXED" };
    } else if (query.status === "EXTRACTED_READY") {
      where.extractionStatus = "LOCKED_AND_INDEXED";
      where.candidateClips = { none: {} };
    } else if (query.status === "DISCOVERY_DONE") {
      where.candidateClips = { some: {} };
    }

    const sessions = await sessionsRepository.listAll(where, query.limit, query.offset);

    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      duration_seconds: s.durationSeconds,
      status: s.extractionStatus,
      progress: s.extractionProgress,
      series_category: s.seriesCategory,
      uploaded_at: s.uploadedAt,
      created_at: s.uploadedAt.toISOString(),
      proxy_url: s.proxyVideoS3Key,
      original_video_key: s.masterVideoS3Key,
      candidates_count: s._count.candidateClips,
      chunks_count: s._count.semanticChunks,
      transcript_segments_count: s._count.transcriptSegments,
      discovery_runs_count: s._count.discoveryRuns,
    }));
  }

  async getSessionById(id: string) {
    const session = await sessionsRepository.findById(id);
    if (!session) {
      throw new AppError(`Discourse session '${id}' not found`, 404);
    }
    return {
      ...session,
      duration_seconds: session.durationSeconds,
      status: session.extractionStatus,
      progress: session.extractionProgress,
      series_category: session.seriesCategory,
      uploaded_at: session.uploadedAt,
      created_at: session.uploadedAt.toISOString(),
      proxy_url: session.proxyVideoS3Key,
      original_video_key: session.masterVideoS3Key,
      candidates_count: session._count.candidateClips,
      chunks_count: session._count.semanticChunks,
      transcript_segments_count: session._count.transcriptSegments,
      keyframes_count: session._count.keyframes,
      scenes_count: session._count.sceneCuts,
      discovery_runs_count: session._count.discoveryRuns,
    };
  }

  async generateUploadUrl(input: GenerateUploadUrlInput) {
    const tempSessionId = `sess_${Date.now()}`;
    const presigned = await s3Service.generatePresignedUploadUrl(
      tempSessionId,
      input.filename,
      input.contentType
    );
    return {
      session_id: tempSessionId,
      ...presigned,
    };
  }

  async createSession(input: CreateSessionInput) {
    const sessionId = `sess_${Date.now()}`;
    const created = await sessionsRepository.create({
      id: sessionId,
      title: input.title,
      description: input.description,
      durationSeconds: input.durationSeconds || 0,
      masterVideoS3Key: input.videoPath || `sessions/${sessionId}/master.mp4`,
      extractionStatus: "EXTRACTING_MEDIA",
      extractionProgress: 10,
    });

    // Seamlessly trigger AI microservice extraction asynchronously
    if (input.videoPath) {
      await aiServiceClient.triggerExtraction(sessionId, input.videoPath, input.title);
    }

    return created;
  }

  async getTranscript(sessionId: string) {
    await this.getSessionById(sessionId); // Ensure session exists
    const segments = await sessionsRepository.getTranscriptSegments(sessionId);
    return segments.map((s) => ({
      id: s.id,
      sessionId: s.sessionId,
      segment_index: s.segmentIndex,
      start_time: s.startTime,
      end_time: s.endTime,
      speaker: s.speakerName,
      speaker_id: s.speakerId,
      text_hindi: s.textHindi,
      text_english: s.textEnglish || s.textHindi,
      sentiment: s.sentiment,
      energy_level: s.energyLevel,
      words: s.wordsJson || [],
    }));
  }

  async getKeyframes(sessionId: string) {
    await this.getSessionById(sessionId); // Ensure session exists
    const keyframes = await sessionsRepository.getKeyframes(sessionId);
    return keyframes.map((k) => ({
      id: k.id,
      sessionId: k.sessionId,
      timestamp: k.timestamp,
      image_url: k.imageS3Key.startsWith("/") ? k.imageS3Key : `/static/media/${k.imageS3Key}`,
      scene_id: k.sceneId || 0,
      ocr_detected_text: k.ocrDetectedText,
      visual_description: k.visualDescription,
      camera_angle: k.cameraAngle || "CLOSE_UP",
      speaker_in_frame: k.speakerInFrame || "Acharya Prashant",
    }));
  }

  async updateSession(
    id: string,
    updates: { title?: string; description?: string; seriesCategory?: string }
  ) {
    await this.getSessionById(id);
    const data: any = {};
    if (updates.title !== undefined) data.title = updates.title.trim();
    if (updates.description !== undefined) data.description = updates.description.trim();
    if (updates.seriesCategory !== undefined) data.seriesCategory = updates.seriesCategory.trim();

    return sessionsRepository.update(id, data);
  }
}

export const sessionsService = new SessionsService();
