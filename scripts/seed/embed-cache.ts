/**
 * Document embeddings with a local, gitignored cache.
 *
 * Keyed by model, input type, and exact text, so a reseed with unchanged text
 * makes no Voyage calls and a changed clause is re-embedded automatically.
 * The cache is a convenience, not the source of truth: deleting .cache/
 * only costs one round of API calls.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { embed } from "../../src/lib/embeddings";
import { EMBEDDING_MODEL } from "../../src/lib/models";
import { sha256 } from "./artifacts";

const CACHE_FILE = path.resolve(".cache/embeddings.json");

export interface CachedEmbedResult {
  /** Vector for each input text, in input order. */
  vectors: number[][];
  apiTokens: number;
  costUsd: number;
  cacheHits: number;
  cacheMisses: number;
}

function cacheKey(text: string): string {
  return sha256(`${EMBEDDING_MODEL}|document|${text}`);
}

function readCache(): Record<string, number[]> {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Record<string, number[]>;
  } catch (error) {
    console.warn(`Embedding cache unreadable, starting empty: ${(error as Error).message}`);
    return {};
  }
}

/** Embed document texts, calling Voyage only for texts not already cached. */
export async function embedDocumentsCached(texts: string[]): Promise<CachedEmbedResult> {
  const cache = readCache();
  const missing = [...new Set(texts.filter((t) => !cache[cacheKey(t)]))];

  let apiTokens = 0;
  let costUsd = 0;
  if (missing.length > 0) {
    const result = await embed(missing, "document");
    missing.forEach((text, i) => {
      cache[cacheKey(text)] = result.vectors[i];
    });
    apiTokens = result.tokens;
    costUsd = result.costUsd;
    mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache));
  }

  const uniqueCount = new Set(texts).size;
  return {
    vectors: texts.map((t) => cache[cacheKey(t)]),
    apiTokens,
    costUsd,
    cacheHits: uniqueCount - missing.length,
    cacheMisses: missing.length,
  };
}
