/**
 * Voyage AI embeddings over fetch. Used by the seed (documents) and stage C
 * (queries). Voyage has no official Node SDK.
 *
 * Batches inputs, retries transient failures (429, 5xx, network) with
 * backoff, and verifies every vector has EMBEDDING_DIM dimensions.
 */

import { EMBEDDING_DIM, EMBEDDING_MODEL, embeddingCostOf } from "./models";

const ENDPOINT = "https://api.voyageai.com/v1/embeddings";
const BATCH_SIZE = 64;
const MAX_ATTEMPTS = 3;

/** Voyage tunes embeddings differently for stored documents and search queries. */
export type InputType = "document" | "query";

export interface EmbedResult {
  vectors: number[][];
  tokens: number;
  costUsd: number;
}

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
  model: string;
  usage: { total_tokens: number };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedBatch(texts: string[], inputType: InputType): Promise<VoyageResponse> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY is not set. Add it to .env.local.");

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response | undefined;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, input_type: inputType }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      // Network failure or timeout: transient, retry.
      lastError = error as Error;
    }

    if (response) {
      const body = await response.text();
      if (response.ok) return JSON.parse(body) as VoyageResponse;
      lastError = new Error(`Voyage HTTP ${response.status}: ${body.slice(0, 300)}`);
      // 401, 400 and other client errors will not succeed on retry.
      if (response.status !== 429 && response.status < 500) throw lastError;
    }

    if (attempt < MAX_ATTEMPTS) {
      const wait = 2000 * 2 ** (attempt - 1);
      console.warn(`Voyage attempt ${attempt} failed (${lastError?.message}); retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw new Error(`Voyage embeddings failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message}`);
}

/** Embed texts in order. Throws on any failure or dimension mismatch. */
export async function embed(texts: string[], inputType: InputType): Promise<EmbedResult> {
  const vectors: number[][] = [];
  let tokens = 0;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await embedBatch(batch, inputType);
    if (response.data.length !== batch.length) {
      throw new Error(`Voyage returned ${response.data.length} vectors for ${batch.length} inputs`);
    }
    const ordered = [...response.data].sort((a, b) => a.index - b.index);
    for (const item of ordered) {
      if (item.embedding.length !== EMBEDDING_DIM) {
        throw new Error(
          `Voyage returned a ${item.embedding.length}-dim vector; expected ${EMBEDDING_DIM}`,
        );
      }
      vectors.push(item.embedding);
    }
    tokens += response.usage.total_tokens;
  }

  return { vectors, tokens, costUsd: embeddingCostOf(tokens) };
}
