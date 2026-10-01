import { prisma } from "../../infrastructure/db/prisma.js";
import type { Prisma } from "@prisma/client";

export class SessionsRepository {
  /**
   * High-Performance Session List Query
   * Only includes needed summary counts rather than scanning all 6 internal extraction tables.
   */
  async listAll(where?: Prisma.VideoSessionWhereInput, limit: number = 50, offset: number = 0) {
    return prisma.videoSession.findMany({
      where,
      select: {
        id: true,
        title: true,
        description: true,
        durationSeconds: true,
        extractionStatus: true,
        extractionProgress: true,
        seriesCategory: true,
        uploadedAt: true,
        masterVideoS3Key: true,
        proxyVideoS3Key: true,
        _count: {
          select: {
            candidateClips: true,
            discoveryRuns: true,
          },
        },
      },
      orderBy: { uploadedAt: "desc" },
      take: limit,
      skip: offset,
    });
  }

  async findById(id: string) {
    return prisma.videoSession.findUnique({
      where: { id },
      include: {
        mediaAssets: true,
        discoveryRuns: {
          orderBy: { startedAt: "desc" },
          take: 5,
        },
        _count: {
          select: {
            candidateClips: true,
            discoveryRuns: true,
            semanticChunks: true,
            transcriptSegments: true,
            keyframes: true,
            sceneCuts: true,
          },
        },
      },
    });
  }

  async create(data: Prisma.VideoSessionCreateInput) {
    return prisma.videoSession.create({ data });
  }

  async update(id: string, data: Prisma.VideoSessionUpdateInput) {
    return prisma.videoSession.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return prisma.videoSession.delete({
      where: { id },
    });
  }

  async getTranscriptSegments(sessionId: string) {
    return prisma.transcriptSegment.findMany({
      where: { sessionId },
      orderBy: { startTime: "asc" },
    });
  }

  async getKeyframes(sessionId: string) {
    return prisma.keyframe.findMany({
      where: { sessionId },
      orderBy: { timestamp: "asc" },
    });
  }
}

export const sessionsRepository = new SessionsRepository();
