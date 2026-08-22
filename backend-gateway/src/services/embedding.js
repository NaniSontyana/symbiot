import { GoogleGenerativeAI } from '@google/generative-ai';
import pool from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Generate a 384-dimensional vector embedding for text using Google Gemini Embedding API
 */
export async function generateEmbedding(text, customApiKey = null) {
  const activeKey = customApiKey || process.env.GEMINI_API_KEY;

  if (!activeKey || activeKey === 'your_gemini_api_key_here' || activeKey.startsWith('AQ.')) {
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
 * Cosine similarity helper for vectors
 */
function calculateCosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(vecA.length, vecB.length);
  for (let i = 0; i < len; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator ? dotProduct / denominator : 0;
}

/**
 * Perform RAG Vector Similarity Search in PostgreSQL (pgvector HNSW + JSONB Fallback)
 */
export async function searchVectorChunks(userId, queryText, customApiKey = null, limit = 5) {
  try {
    const queryEmbedding = await generateEmbedding(queryText, customApiKey);
    const targetUserId = userId || '00000000-0000-0000-0000-000000000000';
    let resultRows = [];

    // Try native pgvector HNSW search first
    try {
      const vectorStr = `[${queryEmbedding.join(',')}]`;
      const pgVectorResult = await pool.query(
        `SELECT chunk_text, doc_type, filename, 
                (1 - (embedding <=> $1::vector)) AS similarity
         FROM documents 
         WHERE (user_id = $2 OR user_id = '00000000-0000-0000-0000-000000000000' OR user_id = '00000000-0000-0000-0000-000000000000')
           AND embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector ASC 
         LIMIT $3`,
        [vectorStr, targetUserId, limit]
      );
      resultRows = pgVectorResult.rows.map(r => ({
        chunkText: r.chunk_text,
        docType: r.doc_type,
        filename: r.filename,
        similarity: parseFloat(r.similarity).toFixed(3)
      }));
    } catch (vErr) {
      // Fallback: Fetch JSONB embeddings and compute cosine similarity in JS
      const allDocsResult = await pool.query(
        `SELECT chunk_text, doc_type, filename, embedding 
         FROM documents 
         WHERE (user_id = $1 OR user_id = '00000000-0000-0000-0000-000000000000' OR user_id = '00000000-0000-0000-0000-000000000000')
           AND embedding IS NOT NULL`,
        [targetUserId]
      );

      const scored = allDocsResult.rows.map(row => {
        let docVec = [];
        try {
          docVec = typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding;
        } catch (e) {}
        const sim = calculateCosineSimilarity(queryEmbedding, docVec);
        return {
          chunkText: row.chunk_text,
          docType: row.doc_type,
          filename: row.filename,
          similarity: parseFloat(sim).toFixed(3)
        };
      });

      scored.sort((a, b) => b.similarity - a.similarity);
      resultRows = scored.slice(0, limit);
    }

    if (resultRows.length === 0) {
      const fallbackResult = await pool.query(
        `SELECT chunk_text, doc_type, filename 
         FROM documents 
         ORDER BY id DESC 
         LIMIT $1`,
        [limit]
      );
      return fallbackResult.rows.map((row) => ({
        chunkText: row.chunk_text,
        docType: row.doc_type,
        filename: row.filename,
        similarity: 0.5,
      }));
    }

    return resultRows;
  } catch (err) {
    console.warn('[Vector Search] Database vector search skipped/fallback:', err.message);
    return [];
  }
}
