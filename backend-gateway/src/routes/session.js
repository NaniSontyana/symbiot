import express from 'express';
import { sessionsInsert, sessionsList, DEMO_USER_ID } from '../config/store.js';

const router = express.Router();

// Create new interview session
router.post('/', async (req, res) => {
  const { userId, targetRole, companyName } = req.body;

  try {
    const session = await sessionsInsert({
      userId: userId || DEMO_USER_ID,
      targetRole: targetRole || 'Software Engineer',
      companyName: companyName || 'Tech Corp',
    });
    res.status(201).json({ session });
  } catch (err) {
    console.error('Create session error:', err.message);
    res.status(500).json({ error: 'Failed to create interview session' });
  }
});

// Get all sessions for user
router.get('/', async (req, res) => {
  const { userId } = req.query;
  try {
    const sessions = await sessionsList(userId || DEMO_USER_ID);
    res.json({ sessions });
  } catch (err) {
    console.error('Fetch sessions error:', err.message);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

export default router;
