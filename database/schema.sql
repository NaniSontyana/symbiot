-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Drop tables if exists for clean setups
DROP TABLE IF EXISTS transcripts CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Users table
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(50) UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Interview Sessions table
CREATE TABLE sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  target_role   VARCHAR(100) NOT NULL,
  company_name  VARCHAR(100),
  status        VARCHAR(20) DEFAULT 'active', -- 'active' | 'completed'
  started_at    TIMESTAMP DEFAULT NOW()
);

-- Candidate Context Documents table (Resume & Job Description chunks)
CREATE TABLE documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  doc_type     VARCHAR(20) NOT NULL CHECK (doc_type IN ('resume', 'job_description')),
  filename     VARCHAR(255) NOT NULL,
  chunk_text   TEXT NOT NULL,
  chunk_index  INT,
  embedding    VECTOR(384) -- 384-dimensional vector embedding
);

-- HNSW Vector Index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS documents_embedding_hnsw_idx 
ON documents 
USING hnsw (embedding vector_cosine_ops);

-- Conversation Transcripts & Copilot Answers table
CREATE TABLE transcripts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID REFERENCES sessions(id) ON DELETE CASCADE,
  speaker      VARCHAR(20) NOT NULL CHECK (speaker IN ('interviewer', 'candidate', 'ai_copilot')),
  text         TEXT NOT NULL,
  citations    JSONB DEFAULT '[]'::jsonb,
  created_at   TIMESTAMP DEFAULT NOW()
);
