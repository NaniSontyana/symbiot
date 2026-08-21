import express from 'express';
import multer from 'multer';
import { createRequire } from 'module';
import pool from '../config/db.js';

const require = createRequire(import.meta.url);
const rawPdfParse = require('pdf-parse');
const pdfParse = typeof rawPdfParse === 'function' ? rawPdfParse : (rawPdfParse.default || rawPdfParse);

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Helper to chunk text into overlapping segments
function chunkText(text, chunkSize = 500, overlap = 50) {
  if (!text) return [];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks;
}

// Upload Text snippet (Resume / JD)
router.post('/upload-text', async (req, res) => {
  const { userId, docType, chunkText: text } = req.body;

  if (!text || !docType) {
    return res.status(400).json({ error: 'chunkText and docType are required' });
  }

  try {
    const chunks = chunkText(text);
    const savedChunks = [];

    for (let index = 0; index < chunks.length; index++) {
      const result = await pool.query(
        `INSERT INTO documents (user_id, doc_type, filename, chunk_text, chunk_index) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id, doc_type, chunk_text, chunk_index`,
        [userId || '00000000-0000-0000-0000-000000000000', docType, 'manual_input.txt', chunks[index], index + 1]
      );
      savedChunks.push(result.rows[0]);
    }

    res.status(201).json({
      message: `Successfully processed ${savedChunks.length} document chunks`,
      chunkCount: savedChunks.length,
      chunks: savedChunks,
    });
  } catch (err) {
    console.error('Text document processing error:', err.message);
    res.status(500).json({ error: 'Failed to process text document context' });
  }
});

// Upload PDF / File Document
router.post('/upload-file', upload.single('file'), async (req, res) => {
  const { userId, docType } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    let extractedText = '';
    const filename = req.file.originalname;

    if (req.file.mimetype === 'application/pdf' || filename.endsWith('.pdf')) {
      const pdfData = await pdfParse(req.file.buffer);
      extractedText = pdfData.text;
    } else {
      extractedText = req.file.buffer.toString('utf-8');
    }

    if (!extractedText || !extractedText.trim()) {
      return res.status(400).json({ error: 'Could not extract text from document' });
    }

    const chunks = chunkText(extractedText);
    const savedChunks = [];

    for (let index = 0; index < chunks.length; index++) {
      const result = await pool.query(
        `INSERT INTO documents (user_id, doc_type, filename, chunk_text, chunk_index) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id, doc_type, filename, chunk_index`,
        [userId || '00000000-0000-0000-0000-000000000000', docType || 'resume', filename, chunks[index], index + 1]
      );
      savedChunks.push(result.rows[0]);
    }

    res.status(201).json({
      message: `File "${filename}" successfully parsed and chunked into ${savedChunks.length} segments`,
      filename,
      chunkCount: savedChunks.length,
      status: 'ready',
    });
  } catch (err) {
    console.error('File parsing error:', err.message);
    res.status(500).json({ error: 'Failed to parse and embed document file' });
  }
});

// Fetch all uploaded documents for user
router.get('/', async (req, res) => {
  const { userId } = req.query;
  try {
    const result = await pool.query(
      `SELECT DISTINCT filename, doc_type, COUNT(*) as chunk_count 
       FROM documents 
       WHERE user_id = $1 
       GROUP BY filename, doc_type`,
      [userId || '00000000-0000-0000-0000-000000000000']
    );

    res.json({ documents: result.rows });
  } catch (err) {
    console.error('Fetch documents error:', err.message);
    res.status(500).json({ error: 'Failed to fetch candidate documents' });
  }
});

export default router;
