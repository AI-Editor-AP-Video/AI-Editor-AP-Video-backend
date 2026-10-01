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

    // Stream uploaded video directly to disk storage (temporary staging for extraction & R2 upload)
    const writeStream = fs.createWriteStream(targetFilePath);
    await pipeline(multipartFile.file, writeStream);

    const title =
      metadata.title?.trim() ||
      multipartFile.filename.replace(/\.[^/.]+$/, "").replace(/_/g, " ") ||
      "Acharya Prashant Discourse";

    // Set up Cloudflare R2 storage keys and public URLs
    const s3MasterKey = `sessions/${sessionId}/${masterFilename}`;
    const masterVideoUrl = s3Service.getAssetPublicUrl(s3MasterKey);
    const proxyUrl = s3Service.getAssetPublicUrl(`sessions/${sessionId}/proxy.mp4`);
    const audioUrl = s3Service.getAssetPublicUrl(`sessions/${sessionId}/audio.wav`);

    // Create session in PostgreSQL with Cloudflare R2 public URLs immediately
    const created = await sessionsRepository.create({
      id: sessionId,
      title,
      description: metadata.description || null,
      seriesCategory: metadata.seriesCategory || "Bhagavad Gita",
      durationSeconds: 0,
      masterVideoS3Key: masterVideoUrl,
      proxyVideoS3Key: proxyUrl,
      audioTrackS3Key: audioUrl,
      extractionStatus: "EXTRACTING_MEDIA",
      extractionProgress: 10,
    });

    // Upload master video to Cloudflare R2 storage in background (non-blocking)
    const mime = multipartFile.mimetype || (ext === ".mp4" ? "video/mp4" : "video/quicktime");
    s3Service.uploadFile(s3MasterKey, targetFilePath, mime)
      .then(() => {
        console.log(`[SessionsService] Master video successfully uploaded to Cloudflare R2: ${s3MasterKey}`);
      })
      .catch((err) => {
        console.warn("[SessionsService] Cloudflare R2 master upload warning:", err);
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
      masterVideoUrl,
      proxyUrl,
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
      proxy_url: s.proxyVideoS3Key ? s3Service.getAssetPublicUrl(s.proxyVideoS3Key) : null,
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
      proxy_url: session.proxyVideoS3Key ? s3Service.getAssetPublicUrl(session.proxyVideoS3Key) : null,
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
      input.contentType || "video/mp4"
    );
    return {
      session_id: tempSessionId,
      ...presigned,
    };
  }

  async createSession(input: CreateSessionInput) {
    const sessionId = (input as any).sessionId || (input as any).id || `sess_${Date.now()}`;
    const s3MasterKey = input.videoPath || `sessions/${sessionId}/master.mp4`;
    const masterVideoUrl = s3MasterKey.startsWith("http") ? s3MasterKey : s3Service.getAssetPublicUrl(s3MasterKey);
    const proxyUrl = s3Service.getAssetPublicUrl(`sessions/${sessionId}/proxy.mp4`);
    const audioUrl = s3Service.getAssetPublicUrl(`sessions/${sessionId}/audio.wav`);

    const created = await sessionsRepository.create({
      id: sessionId,
      title: input.title,
      description: input.description || null,
      seriesCategory: input.seriesCategory || "Bhagavad Gita",
      durationSeconds: input.durationSeconds || 0,
      masterVideoS3Key: masterVideoUrl,
      proxyVideoS3Key: proxyUrl,
      audioTrackS3Key: audioUrl,
      extractionStatus: "EXTRACTING_MEDIA",
      extractionProgress: 10,
    });

    // Seamlessly trigger AI microservice extraction asynchronously with Cloudflare R2 key
    const extractionTarget = input.videoPath || s3MasterKey;
    aiServiceClient.triggerExtraction(sessionId, extractionTarget, input.title).catch((err) => {
      console.warn("[SessionsService] AI extraction trigger warning:", err);
    });

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
      image_url: s3Service.getAssetPublicUrl(k.imageS3Key),
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

  async deleteSession(id: string) {
    const session = await sessionsRepository.findById(id);
    if (!session) {
      throw new AppError(`Discourse session '${id}' not found`, 404);
    }

    const uploadsDir = path.resolve(process.cwd(), "uploads");
    const deletedFiles: string[] = [];

    // 1. Clean up local filesystem artifacts (master video, 480p proxy, 16kHz audio, keyframes folder, and exports)
    if (fs.existsSync(uploadsDir)) {
      try {
        const rootEntries = fs.readdirSync(uploadsDir);
        for (const entry of rootEntries) {
          if (entry.startsWith(`${id}_`) || entry === id) {
            const fullPath = path.join(uploadsDir, entry);
            try {
              fs.rmSync(fullPath, { recursive: true, force: true });
              deletedFiles.push(entry);
              console.log(`[SessionsService] Purged local session asset: ${entry}`);
            } catch (err) {
              console.warn(`[SessionsService] Failed to purge ${fullPath}:`, err);
            }
          }
        }

        // Clean up any candidate export renders tied to this session ID
        const exportsDir = path.join(uploadsDir, "exports");
        if (fs.existsSync(exportsDir)) {
          const exportEntries = fs.readdirSync(exportsDir);
          for (const expFile of exportEntries) {
            if (expFile.includes(id)) {
              const expFullPath = path.join(exportsDir, expFile);
              try {
                fs.rmSync(expFullPath, { recursive: true, force: true });
                deletedFiles.push(`exports/${expFile}`);
                console.log(`[SessionsService] Purged exported clip asset: ${expFile}`);
              } catch (err) {
                console.warn(`[SessionsService] Failed to purge export ${expFullPath}:`, err);
              }
            }
          }
        }
      } catch (err) {
        console.warn("[SessionsService] Warning during disk storage cleanup:", err);
      }
    }

    // 2. Clean up Cloudflare R2 / S3 storage objects
    try {
      await s3Service.deletePrefix(`sessions/${id}/`);
      await s3Service.deletePrefix(`keyframes/${id}/`);
      await s3Service.deletePrefix(`proxies/${id}/`);
      await s3Service.deletePrefix(`audio/${id}/`);
      if (session.masterVideoS3Key && !session.masterVideoS3Key.startsWith("/") && !session.masterVideoS3Key.includes("uploads/")) {
        await s3Service.deleteObject(session.masterVideoS3Key);
      }
      if (session.proxyVideoS3Key && !session.proxyVideoS3Key.startsWith("/")) {
        await s3Service.deleteObject(session.proxyVideoS3Key);
      }
      if (session.audioTrackS3Key && !session.audioTrackS3Key.startsWith("/")) {
        await s3Service.deleteObject(session.audioTrackS3Key);
      }
    } catch (err) {
      console.warn(`[SessionsService] S3/R2 storage purge warning for session "${id}":`, err);
    }

    // 3. Cascade delete from PostgreSQL (removes Session, TranscriptSegments, SemanticChunks, Keyframes, SceneCuts, DiscoveryRuns, CandidateClips, and Decisions)
    await sessionsRepository.delete(id);

    return {
      success: true,
      message: `Session '${session.title}' (${id}) and all associated videos, proxies, audio files, keyframes, and candidate clips have been permanently deleted.`,
      id,
      deletedFilesCount: deletedFiles.length,
      deletedFiles,
    };
  }
}

export const sessionsService = new SessionsService();
