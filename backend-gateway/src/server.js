import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

import authRoutes from './routes/auth.js';
import sessionRoutes from './routes/session.js';
import documentRoutes from './routes/document.js';
import { setupCopilotWebSocket } from './websockets/copilot.js';
import { getStoreMode, usersEnsureDemo, DEMO_USER_ID } from './config/store.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/documents', documentRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'symbiot-backend-gateway',
    storage: getStoreMode(),
    timestamp: new Date().toISOString(),
  });
});

// Create HTTP & WebSocket Server
const server = http.createServer(app);
setupCopilotWebSocket(server);

// Seed the demo account (id demo UUID, password "demo1234") so a fresh
// checkout can sign in immediately, in both Postgres and memory modes.
usersEnsureDemo(bcrypt.hashSync('demo1234', 10)).catch((err) =>
  console.warn('[Store] Demo user seed skipped:', err.message)
);

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Symbiot Backend Gateway running on port ${PORT}`);
  console.log(`📡 WebSocket Copilot stream: ws://localhost:${PORT}/ws/copilot`);
  console.log(`👤 Demo account: candidate@symbiot.ai / demo1234 (user ${DEMO_USER_ID})`);
  console.log(`====================================================`);
});
