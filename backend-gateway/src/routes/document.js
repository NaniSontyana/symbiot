import express from 'express';
import multer from 'multer';
import { createRequire } from 'module';
import { generateEmbedding } from '../services/embedding.js';
import { docsDeleteByFilename, docsInsertChunk, docsListGrouped, DEMO_USER_ID } from '../config/store.js';

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

async function indexDocument({ userId, docType, filename, text, apiKey }) {
  const chunks = chunkText(text);
  const savedChunks = [];
  const targetUserId = userId || DEMO_USER_ID;

  // Clear existing chunks of this name for clean re-indexing
  await docsDeleteByFilename(targetUserId, filename);

  for (let index = 0; index < chunks.length; index++) {
    const chunkStr = chunks[index];
    const embeddingVec = await generateEmbedding(chunkStr, apiKey);
    const saved = await docsInsertChunk({
      userId: targetUserId,
      docType,
      filename,
      chunkText: chunkStr,
      chunkIndex: index + 1,
      embedding: embeddingVec,
    });
    savedChunks.push(saved);
  }
  return savedChunks;
}

// Upload Text snippet (Resume / JD)
router.post('/upload-text', async (req, res) => {
  const { userId, docType, chunkText: text, apiKey } = req.body;

  if (!text || !docType) {
    return res.status(400).json({ error: 'chunkText and docType are required' });
  }

  try {
    const savedChunks = await indexDocument({
      userId,
      docType,
      filename: 'manual_input.txt',
      text,
      apiKey,
    });
    res.status(201).json({
      message: `Successfully indexed ${savedChunks.length} document chunks with vector embeddings`,
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
  const { userId, docType, apiKey } = req.body;

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

    const savedChunks = await indexDocument({
      userId,
      docType: docType || 'resume',
      filename,
      text: extractedText,
      apiKey,
    });

    res.status(201).json({
      message: `File "${filename}" successfully parsed and vector-indexed into ${savedChunks.length} chunks`,
      filename,
      chunkCount: savedChunks.length,
      status: 'ready',
      docType: docType || 'resume',
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
    const documents = await docsListGrouped(userId || DEMO_USER_ID);
    res.json({ documents });
  } catch (err) {
    console.error('Fetch documents error:', err.message);
    res.status(500).json({ error: 'Failed to fetch candidate documents' });
  }
});

// Delete uploaded document by filename
router.delete('/:filename', async (req, res) => {
  const { filename } = req.params;
  const { userId } = req.query;

  try {
    const deletedCount = await docsDeleteByFilename(userId || DEMO_USER_ID, filename);
    res.json({ message: `Successfully deleted document "${filename}"`, deletedCount });
  } catch (err) {
    console.error('Delete document error:', err.message);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

export default router;
