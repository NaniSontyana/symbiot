import crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { docsVectorSearch, docsLatest, DEMO_USER_ID } from '../config/store.js';

dotenv.config();

/**
 * Embedding LRU cache. Interviews repeat vocabulary and questions, so a warm
 * cache turns the Gemini embedding round-trip (~200-600 ms) into a memory hit.
 */
const EMBEDDING_CACHE_MAX = 512;
const embeddingCache = new Map();

function cacheKeyFor(text, keyHint) {
  return crypto
    .createHash('sha1')
    .update(keyHint ? 'keyed' : 'mock')
    .update('\n')
    .update(text)
    .digest('hex');
}

export function clearEmbeddingCache() {
  embeddingCache.clear();
}

/**
 * Generate a 384-dimensional embedding for a text document chunk.
 * Falls back to a deterministic normalized mock vector when no API key is configured.
 */
export async function generateEmbedding(text, customApiKey = null) {
  const activeKey = customApiKey || process.env.GEMINI_API_KEY;
  const hasLiveKey = !!activeKey && activeKey !== 'your_gemini_api_key_here' && !activeKey.startsWith('AQ.');

  const cacheKey = cacheKeyFor(text, hasLiveKey);
  const cached = embeddingCache.get(cacheKey);
  if (cached) {
    // Refresh LRU recency
    embeddingCache.delete(cacheKey);
    embeddingCache.set(cacheKey, cached);
    return cached;
  }

  const vector = await computeEmbedding(text, activeKey, hasLiveKey);

  embeddingCache.set(cacheKey, vector);
  if (embeddingCache.size > EMBEDDING_CACHE_MAX) {
    // Evict least-recently-used entry (Map iteration order = insertion order)
    embeddingCache.delete(embeddingCache.keys().next().value);
  }
  return vector;
}

async function computeEmbedding(text, activeKey, hasLiveKey) {
  if (!hasLiveKey) {
    // Return mock 384-dim normalized vector if API key is not configured
    return createNormalizedMockVector(text, 384);
  }

  try {
    const genAI = new GoogleGenerativeAI(activeKey);
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });

    // Request embedding from Gemini API
    const result = await model.embedContent({
      content: { parts: [{ text }] },
      outputDimensionality: 384,
    });

    const values = result.embedding?.values;
    if (values && values.length === 384) {
      return values;
    } else if (values && values.length > 0) {
      // If default 768 dims returned, slice or normalize to 384 dims
      return values.slice(0, 384);
    }

    return createNormalizedMockVector(text, 384);
  } catch (err) {
    console.warn('[Embedding Service] Gemini API embedding error, fallback used:', err.message);
    return createNormalizedMockVector(text, 384);
  }
}

/**
 * Deterministic pseudo-random normalized vector fallback for offline/test environments
 */
function createNormalizedMockVector(text, dim = 384) {
  const vec = new Array(dim);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }

  let norm = 0;
  for (let i = 0; i < dim; i++) {
    const val = Math.sin(hash + i);
    vec[i] = val;
    norm += val * val;
  }

  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

/**
 * Perform RAG Vector Similarity Search (pgvector HNSW in Postgres mode,
 * JS-side cosine scoring in memory mode) via the unified store.
 */
export async function searchVectorChunks(userId, queryText, customApiKey = null, limit = 5) {
  try {
    const queryEmbedding = await generateEmbedding(queryText, customApiKey);
    const targetUserId = userId || DEMO_USER_ID;

    let resultRows = await docsVectorSearch(queryEmbedding, targetUserId, limit);

    if (resultRows.length === 0) {
      const latest = await docsLatest(limit);
      return latest.map((row) => ({
        chunkText: row.chunk_text,
        docType: row.doc_type,
        filename: row.filename,
        similarity: 0.5,
      }));
    }

    return resultRows;
  } catch (err) {
    console.warn('[Vector Search] Search skipped/fallback:', err.message);
    return [];
  }
}
