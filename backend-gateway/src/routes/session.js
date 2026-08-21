import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

// Create new interview session
router.post('/', async (req, res) => {
  const { userId, targetRole, companyName } = req.body;

  try {
    const result = await pool.query(
      'INSERT INTO sessions (user_id, target_role, company_name) VALUES ($1, $2, $3) RETURNING *',
      [userId || '00000000-0000-0000-0000-000000000000', targetRole || 'Software Engineer', companyName || 'Tech Corp']
    );
    res.status(201).json({ session: result.rows[0] });
  } catch (err) {
    console.error('Create session error:', err.message);
    res.status(500).json({ error: 'Failed to create interview session' });
  }
});

// Get all sessions for user
router.get('/', async (req, res) => {
  const { userId } = req.query;
  try {
    const result = await pool.query(
      'SELECT * FROM sessions WHERE user_id = $1 ORDER BY started_at DESC',
      [userId || '00000000-0000-0000-0000-000000000000']
    );
    res.json({ sessions: result.rows });
  } catch (err) {
    console.error('Fetch sessions error:', err.message);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

export default router;
