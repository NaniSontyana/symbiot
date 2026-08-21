import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import sessionRoutes from './routes/session.js';
import documentRoutes from './routes/document.js';
import { setupCopilotWebSocket } from './websockets/copilot.js';

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
    timestamp: new Date().toISOString(),
  });
});

// Create HTTP & WebSocket Server
const server = http.createServer(app);
setupCopilotWebSocket(server);

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Symbiot Backend Gateway running on port ${PORT}`);
  console.log(`📡 WebSocket Copilot stream: ws://localhost:${PORT}/ws/copilot`);
  console.log(`====================================================`);
});
