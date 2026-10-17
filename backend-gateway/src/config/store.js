import crypto from 'crypto';
import pool from './db.js';

/**
 * Unified persistence layer.
 *
 * Production mode uses PostgreSQL (with the pgvector extension when
 * installed). If the database server is unreachable (first connection
 * failure), every operation transparently degrades to an in-memory
 * store so the whole application keeps working for local demos and CI.
 *
 * The SQL executed in Postgres mode is byte-identical to the queries
 * the routes used before this layer existed.
 */

export const DEMO_USER_ID = '00000000-0000-0000-0000-000000000000';

let mode = 'unknown'; // 'postgres' | 'memory'

const mem = {
  users: [],
  sessions: [],
  documents: [],
  transcripts: [],
};

export function getStoreMode() {
  return mode;
}

function looksLikeConnectionError(err) {
  const code = err && (err.code || (err.errors && err.errors[0] && err.errors[0].code));
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    /password authentication failed|no pg_hba\.conf|Connection terminated|server closed the connection|connect ECONNREFUSED|timeout expired|getaddrinfo/i.test(
      (err && err.message) || ''
    )
  );
}

/**
 * Run `pgFn` in Postgres mode; on a connection-level failure flip to
 * memory mode and run `memFn`. Non-connection SQL errors still throw so
 * real bugs are never hidden.
 */
async function degrade(pgFn, memFn) {
  if (mode === 'memory') return memFn();
  try {
    const result = await pgFn();
    if (mode === 'unknown') {
      mode = 'postgres';
      console.log('[Store] Connected to PostgreSQL — persistent mode enabled');
    }
    return result;
  } catch (err) {
    if (mode === 'postgres' || !looksLikeConnectionError(err)) {
      throw err;
    }
    mode = 'memory';
    console.warn(`[Store] PostgreSQL unreachable (${err.message}). Falling back to in-memory store.`);
    return memFn();
  }
}

// ------------------------------------------------------------------ users
export async function usersInsert({ id = crypto.randomUUID(), username, email, passwordHash }) {
  return degrade(
    async () => {
      const r = await pool.query(
        'INSERT INTO users (id, username, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, username, email, created_at',
        [id, username, email, passwordHash]
      );
      return r.rows[0];
    },
    async () => {
      if (mem.users.some((u) => u.email === email) || mem.users.some((u) => u.username === username)) {
        const dup = new Error('duplicate key value violates unique constraint');
        dup.code = '23505';
        throw dup;
      }
      const user = { id, username, email, password_hash: passwordHash, created_at: new Date().toISOString() };
      mem.users.push(user);
      const { password_hash, ...safe } = user;
      return safe;
    }
  );
}

export async function usersFindByEmail(email) {
  return degrade(
    async () => {
      const r = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      return r.rows[0] || null;
    },
    async () => mem.users.find((u) => u.email === email) || null
  );
}

export async function usersEnsureDemo(passwordHash) {
  return degrade(
    async () => {
      await pool.query(
        `INSERT INTO users (id, username, email, password_hash)
         VALUES ($1, 'demo_candidate', 'candidate@symbiot.ai', $2)
         ON CONFLICT (id) DO NOTHING`,
        [DEMO_USER_ID, passwordHash]
      );
    },
    async () => {
      if (!mem.users.some((u) => u.id === DEMO_USER_ID)) {
        mem.users.push({
          id: DEMO_USER_ID,
          username: 'demo_candidate',
          email: 'candidate@symbiot.ai',
          password_hash: passwordHash,
          created_at: new Date().toISOString(),
        });
      }
    }
  );
}

// ------------------------------------------------------------------ sessions
export async function sessionsInsert({ userId, targetRole, companyName }) {
  return degrade(
    async () => {
      const r = await pool.query(
        'INSERT INTO sessions (user_id, target_role, company_name) VALUES ($1, $2, $3) RETURNING *',
        [userId, targetRole, companyName]
      );
      return r.rows[0];
    },
    async () => {
      const session = {
        id: crypto.randomUUID(),
        user_id: userId,
        target_role: targetRole,
        company_name: companyName,
        status: 'active',
        started_at: new Date().toISOString(),
      };
      mem.sessions.push(session);
      return session;
    }
  );
}

export async function sessionsList(userId) {
  return degrade(
    async () => {
      const r = await pool.query('SELECT * FROM sessions WHERE user_id = $1 ORDER BY started_at DESC', [userId]);
      return r.rows;
    },
    async () =>
      mem.sessions
        .filter((s) => s.user_id === userId)
        .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
  );
}

// ------------------------------------------------------------------ documents
export async function docsDeleteByFilename(userId, filename) {
  const matchIds = [userId, DEMO_USER_ID];
  return degrade(
    async () => {
      const r = await pool.query('DELETE FROM documents WHERE filename = $1 AND (user_id = $2 OR user_id = $3)', [
        filename,
        userId,
        DEMO_USER_ID,
      ]);
      return r.rowCount;
    },
    async () => {
      const before = mem.documents.length;
      mem.documents = mem.documents.filter(
        (d) => !(d.filename === filename && matchIds.includes(d.user_id))
      );
      return before - mem.documents.length;
    }
  );
}

export async function docsInsertChunk({ userId, docType, filename, chunkText, chunkIndex, embedding }) {
  return degrade(
    async () => {
      const r = await pool.query(
        `INSERT INTO documents (user_id, doc_type, filename, chunk_text, chunk_index, embedding)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, doc_type, chunk_text, chunk_index`,
        [userId, docType, filename, chunkText, chunkIndex, JSON.stringify(embedding)]
      );
      return r.rows[0];
    },
    async () => {
      const row = {
        id: crypto.randomUUID(),
        user_id: userId,
        doc_type: docType,
        filename,
        chunk_text: chunkText,
        chunk_index: chunkIndex,
        embedding: embedding.slice(),
      };
      mem.documents.push(row);
      return { id: row.id, doc_type: row.doc_type, chunk_text: row.chunk_text, chunk_index: row.chunk_index };
    }
  );
}

export async function docsListGrouped(userId) {
  return degrade(
    async () => {
      const r = await pool.query(
        `SELECT filename, doc_type, COUNT(*) as chunk_count, MAX(id::text) as last_id
         FROM documents
         WHERE (user_id = $1 OR user_id = $2)
         GROUP BY filename, doc_type
         ORDER BY last_id DESC`,
        [userId, DEMO_USER_ID]
      );
      return r.rows;
    },
    async () => {
      const groups = new Map();
      for (const d of mem.documents) {
        if (d.user_id !== userId && d.user_id !== DEMO_USER_ID) continue;
        const key = `${d.filename}||${d.doc_type}`;
        const g = groups.get(key);
        if (g) {
          g.chunk_count += 1;
        } else {
          groups.set(key, { filename: d.filename, doc_type: d.doc_type, chunk_count: 1 });
        }
      }
      return [...groups.values()].reverse();
    }
  );
}

function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(vecA.length, vecB.length);
  for (let i = 0; i < len; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom ? dot / denom : 0;
}

/**
 * Vector similarity search over document chunks. Postgres mode tries the
 * native pgvector HNSW operator first and falls back to JS-side cosine
 * scoring when the extension/cast is unavailable. Memory mode always
 * scores in JS.
 */
export async function docsVectorSearch(queryEmbedding, userId, limit = 5) {
  if (mode !== 'memory') {
    try {
      const vectorStr = `[${queryEmbedding.join(',')}]`;
      const r = await pool.query(
        `SELECT chunk_text, doc_type, filename,
                (1 - (embedding <=> $1::vector)) AS similarity
         FROM documents
         WHERE (user_id = $2 OR user_id = $3)
           AND embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector ASC
         LIMIT $4`,
        [vectorStr, userId, DEMO_USER_ID, limit]
      );
      mode = mode === 'unknown' ? 'postgres' : mode;
      return r.rows.map((row) => ({
        chunkText: row.chunk_text,
        docType: row.doc_type,
        filename: row.filename,
        similarity: parseFloat(parseFloat(row.similarity).toFixed(3)),
      }));
    } catch (err) {
      if (mode === 'postgres' || !looksLikeConnectionError(err)) {
        // Non-connection error (e.g. embedding stored as JSONB, not vector):
        // fall through to the JS scoring path below instead of failing.
        console.warn('[Store] pgvector search unavailable, scoring in JS:', err.message);
      } else {
        mode = 'memory';
        console.warn(`[Store] PostgreSQL unreachable (${err.message}). Falling back to in-memory store.`);
      }
    }
  }

  let rows;
  if (mode === 'memory') {
    rows = mem.documents.filter(
      (d) => (d.user_id === userId || d.user_id === DEMO_USER_ID) && Array.isArray(d.embedding)
    );
  } else {
    try {
      const r = await pool.query(
        `SELECT chunk_text, doc_type, filename, embedding
         FROM documents
         WHERE (user_id = $1 OR user_id = $2)
           AND embedding IS NOT NULL`,
        [userId, DEMO_USER_ID]
      );
      rows = r.rows.map((row) => {
        let vec = row.embedding;
        if (typeof vec === 'string') {
          try {
            vec = JSON.parse(vec);
          } catch {
            vec = [];
          }
        }
        return { ...row, embedding: vec };
      });
    } catch (err) {
      console.warn('[Store] Document fetch failed:', err.message);
      rows = [];
    }
  }

  return rows
    .map((row) => ({
      chunkText: row.chunk_text,
      docType: row.doc_type,
      filename: row.filename,
      similarity: parseFloat(cosineSimilarity(queryEmbedding, row.embedding).toFixed(3)),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export async function docsLatest(limit = 5) {
  return degrade(
    async () => {
      const r = await pool.query('SELECT chunk_text, doc_type, filename FROM documents ORDER BY id DESC LIMIT $1', [
        limit,
      ]);
      return r.rows;
    },
    async () => mem.documents.slice(-limit).reverse()
  );
}

// ------------------------------------------------------------------ transcripts
export async function transcriptsInsert({ sessionId, speaker, text, citations = [] }) {
  return degrade(
    async () => {
      const r = await pool.query(
        'INSERT INTO transcripts (session_id, speaker, text, citations) VALUES ($1, $2, $3, $4) RETURNING id',
        [sessionId, speaker, text, JSON.stringify(citations)]
      );
      return r.rows[0];
    },
    async () => {
      const row = {
        id: crypto.randomUUID(),
        session_id: sessionId,
        speaker,
        text,
        citations,
        created_at: new Date().toISOString(),
      };
      mem.transcripts.push(row);
      return { id: row.id };
    }
  );
}
