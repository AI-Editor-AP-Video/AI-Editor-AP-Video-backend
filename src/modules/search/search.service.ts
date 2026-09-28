import { prisma } from "../../infrastructure/db/prisma.js";
import { searchSemanticChunksByVector } from "../../infrastructure/db/pgvector.js";

export interface HybridSearchInput {
  query: string;
  query_vector?: number[];
  session_id?: string;
  top_n?: number;
  min_similarity?: number;
}

export class SearchService {
  async executeHybridSearch(input: HybridSearchInput) {
    const topN = input.top_n || 10;
    const minSim = input.min_similarity || 0.40;

    if (input.query_vector && input.query_vector.length > 0) {
      // Execute native pgvector cosine similarity search
      const vectorResults = await searchSemanticChunksByVector(
        input.query_vector,
        input.session_id,
        topN,
        minSim
      );
      return vectorResults;
    }

    // Fallback to PostgreSQL full-text search on discourse text
    const chunks = await prisma.semanticChunk.findMany({
      where: {
        text: { contains: input.query, mode: "insensitive" },
        ...(input.session_id ? { sessionId: input.session_id } : {}),
      },
      take: topN,
      orderBy: { startTime: "asc" },
    });

    return chunks.map((c) => ({
      id: c.id,
      sessionId: c.sessionId,
      startTime: c.startTime,
      endTime: c.endTime,
      text: c.text,
      similarity: 0.80, // Default keyword match score
    }));
  }
}

export const searchService = new SearchService();
