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
 * Perform RAG Vector Similarity Search in PostgreSQL (pgvector HNSW)
 */
export async function searchVectorChunks(userId, queryText, customApiKey = null, limit = 5) {
  try {
    const queryEmbedding = await generateEmbedding(queryText, customApiKey);
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    const result = await pool.query(
      `SELECT chunk_text, doc_type, filename, 
              (1 - (embedding <=> $1::vector)) AS similarity
       FROM documents 
       WHERE (user_id = $2 OR user_id = '00000000-0000-0000-0000-000000000000' OR user_id = 'demo-candidate-123')
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector ASC 
       LIMIT $3`,
      [vectorStr, userId, limit]
    );

    if (result.rows.length === 0) {
      // Fallback query if no embeddings match yet
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

    return result.rows.map((row) => ({
      chunkText: row.chunk_text,
      docType: row.doc_type,
      filename: row.filename,
      similarity: parseFloat(row.similarity).toFixed(3),
    }));
  } catch (err) {
    console.warn('[Vector Search] Database vector search skipped/fallback:', err.message);
    return [];
  }
}
