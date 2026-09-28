import { prisma } from "../../infrastructure/db/prisma.js";
import type { Prisma } from "@prisma/client";

export class SessionsRepository {
  async listAll(where?: Prisma.VideoSessionWhereInput, limit: number = 50, offset: number = 0) {
    return prisma.videoSession.findMany({
      where,
      include: {
        _count: {
          select: {
            candidateClips: true,
            semanticChunks: true,
            transcriptSegments: true,
            discoveryRuns: true,
            keyframes: true,
            sceneCuts: true,
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
        },
        candidateClips: {
          orderBy: { finalApScore: "desc" },
        },
        _count: {
          select: {
            semanticChunks: true,
            transcriptSegments: true,
            keyframes: true,
            sceneCuts: true,
            candidateClips: true,
            discoveryRuns: true,
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
