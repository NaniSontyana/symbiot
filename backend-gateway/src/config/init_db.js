import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const dbUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/parakeet_db';

export async function initDatabase() {
  console.log('====================================================');
  console.log('🗄️  Symbiot PostgreSQL Database Setup & Migration');
  console.log('====================================================');

  let user = process.env.PGUSER || process.env.DB_USER || 'postgres';
  let password = process.env.PGPASSWORD || process.env.DB_PASSWORD || 'postgres';
  let host = process.env.PGHOST || process.env.DB_HOST || 'localhost';
  let port = parseInt(process.env.PGPORT || process.env.DB_PORT || '5432', 10);
  let dbName = process.env.PGDATABASE || process.env.DB_NAME || 'parakeet_db';

  if (process.env.DATABASE_URL && !process.env.PGPASSWORD && !process.env.DB_PASSWORD) {
    try {
      const urlObj = new URL(process.env.DATABASE_URL);
      user = urlObj.username ? decodeURIComponent(urlObj.username) : user;
      password = urlObj.password ? decodeURIComponent(urlObj.password) : password;
      host = urlObj.hostname || host;
      port = parseInt(urlObj.port || String(port), 10);
      dbName = urlObj.pathname.replace(/^\//, '') || dbName;
    } catch (e) {
      // If URL parsing fails
    }
  }

  console.log(`📡 Connecting to PostgreSQL instance at ${host}:${port} as user "${user}"...`);

  // Step 1: Connect to root postgres DB to check database existence
  const rootClient = new pg.Client({
    user,
    password,
    host,
    port,
    database: 'postgres',
  });

  try {
    await rootClient.connect();
    console.log(`✅ Connection to PostgreSQL server successful!`);

    const res = await rootClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
    if (res.rows.length === 0) {
      console.log(`🛠️  Creating database "${dbName}"...`);
      await rootClient.query(`CREATE DATABASE "${dbName}"`);
      console.log(`✅ Database "${dbName}" created successfully!`);
    } else {
      console.log(`ℹ️  Database "${dbName}" already exists.`);
    }
  } catch (err) {
    console.warn(`⚠️  Root PostgreSQL connection check: ${err.message}`);
    console.warn(`👉 Make sure PostgreSQL service is running on ${host}:${port} and credentials in backend-gateway/.env are correct.`);
  } finally {
    await rootClient.end().catch(() => {});
  }

  // Step 2: Connect to target database and apply schema
  const dbPool = new pg.Pool({
    user,
    password,
    host,
    port,
    database: dbName,
  });

  try {
    const schemaPath = path.join(__dirname, '../../../database/schema.sql');
    console.log(`📜 Reading schema from: ${schemaPath}`);
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log(`⚡ Executing schema migration...`);
    
    // Check if pgvector extension is available
    let hasVector = false;
    try {
      await dbPool.query('CREATE EXTENSION IF NOT EXISTS vector;');
      hasVector = true;
      console.log('✅ pgvector extension enabled!');
    } catch (vErr) {
      console.warn('ℹ️  pgvector extension not installed locally. Using JSONB fallback for document embeddings.');
    }

    // Adapt schema if vector extension is not available
    let executableSql = schemaSql.replace('CREATE EXTENSION IF NOT EXISTS vector;', '');
    if (!hasVector) {
      executableSql = executableSql
        .replace('embedding    VECTOR(384)', 'embedding    JSONB')
        .replace(/CREATE INDEX IF NOT EXISTS documents_embedding_hnsw_idx[\s\S]*?vector_cosine_ops\);/, '');
    }

    await dbPool.query(executableSql);
    console.log(`✅ All tables (users, sessions, documents, transcripts) created successfully!`);

    // Step 3: Insert default demo user
    const demoUserId = '00000000-0000-0000-0000-000000000000';
    await dbPool.query(
      `INSERT INTO users (id, username, email, password_hash)
       VALUES ($1, 'demo_candidate', 'candidate@symbiot.ai', 'hashed_pass_2026')
       ON CONFLICT (id) DO NOTHING`,
      [demoUserId]
    );

    console.log('🎉 Database initialization complete and ready!');
  } catch (err) {
    console.error('❌ Database Setup Error:', err.message);
    console.error(`💡 Tip: Check backend-gateway/.env DATABASE_URL credentials or run PostgreSQL locally.`);
  } finally {
    await dbPool.end();
  }
}

// Auto-run if executed directly via CLI
initDatabase();
