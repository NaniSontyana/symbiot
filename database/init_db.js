import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../backend-gateway/.env') });

const dbUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/parakeet_db';

async function initDatabase() {
  console.log('====================================================');
  console.log('🗄️  Symbiot PostgreSQL Database Setup & Migration');
  console.log('====================================================');

  // Parse connection URL or credentials
  const urlObj = new URL(dbUrl);
  const user = urlObj.username || 'postgres';
  const password = urlObj.password || 'postgres';
  const host = urlObj.hostname || 'localhost';
  const port = urlObj.port || 5432;
  const dbName = urlObj.pathname.replace('/', '') || 'parakeet_db';

  // Step 1: Connect to default postgres DB to ensure target database exists
  const rootClient = new pg.Client({
    user,
    password,
    host,
    port,
    database: 'postgres',
  });

  try {
    await rootClient.connect();
    console.log(`📡 Connected to PostgreSQL instance at ${host}:${port}`);

    const res = await rootClient.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
    if (res.rows.length === 0) {
      console.log(`🛠️  Creating database "${dbName}"...`);
      await rootClient.query(`CREATE DATABASE "${dbName}"`);
      console.log(`✅ Database "${dbName}" created successfully!`);
    } else {
      console.log(`ℹ️  Database "${dbName}" already exists.`);
    }
  } catch (err) {
    console.warn(`⚠️  PostgreSQL connection check: ${err.message}`);
  } finally {
    await rootClient.end();
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
    console.log(`📜 Reading database/schema.sql...`);
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log(`⚡ Executing schema migration & vector extension setup...`);
    await dbPool.query(schemaSql);
    console.log(`✅ All tables (users, sessions, documents, transcripts) & vector indexes created!`);

    // Step 3: Insert default demo user and initial resume context
    const demoUserId = '00000000-0000-0000-0000-000000000000';
    await dbPool.query(
      `INSERT INTO users (id, username, email, password_hash)
       VALUES ($1, 'demo_candidate', 'candidate@symbiot.ai', 'hashed_pass_2026')
       ON CONFLICT (id) DO NOTHING`,
      [demoUserId]
    );

    console.log('🎉 Database initialization complete and ready for RAG vector queries!');
  } catch (err) {
    console.error('❌ Database Initialization Error:', err.message);
  } finally {
    await dbPool.end();
  }
}

initDatabase();
