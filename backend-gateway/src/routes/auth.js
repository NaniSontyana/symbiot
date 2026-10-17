import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { usersInsert, usersFindByEmail } from '../config/store.js';

const router = express.Router();
const JWT_TTL = '7d';

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'parakeet_secret', { expiresIn: JWT_TTL });
}

// User Signup / Register
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  try {
    const passwordHash = await bcrypt.hash(String(password), 10);
    const user = await usersInsert({ username: String(username).trim(), email: String(email).trim().toLowerCase(), passwordHash });
    res.status(201).json({ user, token: signToken(user.id) });
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'An account with this email or username already exists' });
    }
    console.error('Registration error:', err.message);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// User Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await usersFindByEmail(String(email).trim().toLowerCase());
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordOk = await bcrypt.compare(String(password), user.password_hash || '');
    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({
      user: { id: user.id, username: user.username, email: user.email },
      token: signToken(user.id),
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

export default router;
