import { prisma } from "./prisma.js";

export interface SemanticSearchResult {
  id: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  text: string;
  similarity: number;
}

/**
 * Execute native pgvector cosine similarity search using parameterized SQL
 */
export async function searchSemanticChunksByVector(
  queryVector: number[],
  sessionId?: string,
  topN: number = 10,
  minSimilarity: number = 0.50
): Promise<SemanticSearchResult[]> {
  const vectorStr = `[${queryVector.join(",")}]`;

  if (sessionId) {
    const rawResults = await prisma.$queryRaw<
      { id: string; sessionId: string; startTime: number; endTime: number; text: string; similarity: number }[]
    >`
      SELECT 
        id, 
        "sessionId", 
        "startTime", 
        "endTime", 
        text, 
        1 - (embedding <=> ${vectorStr}::vector) AS similarity
      FROM "semantic_chunks"
      WHERE "sessionId" = ${sessionId}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorStr}::vector ASC
      LIMIT ${topN};
    `;
    return rawResults.filter((r) => r.similarity >= minSimilarity);
  }

  const rawResults = await prisma.$queryRaw<
    { id: string; sessionId: string; startTime: number; endTime: number; text: string; similarity: number }[]
  >`
    SELECT 
      id, 
      "sessionId", 
      "startTime", 
      "endTime", 
      text, 
      1 - (embedding <=> ${vectorStr}::vector) AS similarity
    FROM "semantic_chunks"
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorStr}::vector ASC
    LIMIT ${topN};
  `;
  return rawResults.filter((r) => r.similarity >= minSimilarity);
}
