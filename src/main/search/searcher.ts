import type Database from "better-sqlite3";
import type { SearchResult, SearchResponse } from "../../shared/types";
import type { EmbedConfig } from "./embedder";
import {
  embedQuery,
  bufferToEmbedding,
  getEmbeddingModelName,
} from "./embedder";
import {
  getChunksWithEmbeddingsByModel,
  getDocumentsByIds,
} from "../db/database";
import { rerank } from "./reranker";

const COSINE_TOP_K = 40;
const RESULT_LIMIT = 8;

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `Embedding dimension mismatch: query has ${a.length}, chunk has ${b.length}`,
    );
  }
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export async function search(
  db: Database.Database,
  query: string,
  embedConfig: EmbedConfig,
): Promise<SearchResponse> {
  const queryEmbedding = await embedQuery(query, embedConfig);
  const model = getEmbeddingModelName(embedConfig);

  const chunks = getChunksWithEmbeddingsByModel(db, model);
  if (chunks.length === 0) return { results: [], rerankFailed: false };

  if (chunks.length >= 5000) {
    console.warn(
      `Search loading ${chunks.length} chunks into memory — consider limiting corpus size`,
    );
  }

  const scored = chunks
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(
        queryEmbedding,
        bufferToEmbedding(chunk.embedding!),
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, COSINE_TOP_K);

  let topResults: typeof scored;
  let rerankFailed = false;

  if (embedConfig.apiKey) {
    try {
      const scoredById = new Map(scored.map((s) => [s.chunk.id, s]));
      const reranked = await rerank(
        query,
        scored.map((s) => ({ id: s.chunk.id, text: s.chunk.text })),
        embedConfig.apiKey!,
        RESULT_LIMIT,
      );
      topResults = reranked
        .map((r) => {
          const entry = scoredById.get(r.id);
          return entry ? { chunk: entry.chunk, score: r.score } : null;
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);
    } catch {
      rerankFailed = true;
      topResults = scored.slice(0, RESULT_LIMIT);
    }
  } else {
    topResults = scored.slice(0, RESULT_LIMIT);
  }

  const docIds = [...new Set(topResults.map((r) => r.chunk.documentId))];
  const docMap = getDocumentsByIds(db, docIds);

  const results: SearchResult[] = [];
  for (const { chunk, score } of topResults) {
    const doc = docMap.get(chunk.documentId);
    if (!doc) continue;
    results.push({
      chunkId: chunk.id,
      documentTitle: doc.title,
      snippet: chunk.text,
      heading: chunk.heading,
      url: doc.url,
      provider: doc.provider as "notion" | "google_drive",
      score,
    });
  }

  return { results, rerankFailed };
}
