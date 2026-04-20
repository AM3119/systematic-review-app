import path from 'path';
import fs from 'fs';

// Load .env before anything else
try { require('dotenv').config({ path: path.join(__dirname, '../.env') }); } catch {}

import express from 'express';
import cors from 'cors';
import path from 'path';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import authRoutes from './routes/auth';
import reviewRoutes from './routes/reviews';
import articleRoutes from './routes/articles';
import screeningRoutes from './routes/screening';
import extractionRoutes from './routes/extraction';
import { JWT_SECRET } from './middleware/auth';

const app = express();
const httpServer = createServer(app);

const ALLOWED_ORIGIN = process.env.FRONTEND_URL || 'http://localhost:5173';

const io = new SocketServer(httpServer, {
  cors: { origin: ALLOWED_ORIGIN, credentials: true }
});

app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express.json({ limit: '20mb' }));

// Serve uploaded PDFs as static files
const PDF_DIR = path.join(__dirname, '../../data/pdfs');
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });
app.use('/api/pdfs', express.static(PDF_DIR));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/reviews', articleRoutes);
app.use('/api/reviews', screeningRoutes);
app.use('/api/reviews', extractionRoutes);

// Socket.io for real-time collaboration
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    const user = jwt.verify(token, JWT_SECRET) as any;
    (socket as any).user = user;
    next();
  } catch {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  const user = (socket as any).user;

  socket.on('join-review', (reviewId: string) => {
    socket.join(`review:${reviewId}`);
    socket.to(`review:${reviewId}`).emit('user-joined', { userId: user.id, name: user.name });
  });

  socket.on('leave-review', (reviewId: string) => {
    socket.leave(`review:${reviewId}`);
    socket.to(`review:${reviewId}`).emit('user-left', { userId: user.id, name: user.name });
  });

  socket.on('screening-decision', (data: any) => {
    socket.to(`review:${data.reviewId}`).emit('decision-made', { userId: user.id, name: user.name, ...data });
  });

  socket.on('typing', (data: any) => {
    socket.to(`review:${data.reviewId}`).emit('collaborator-typing', { userId: user.id, name: user.name, ...data });
  });

  socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`✅ SRA Backend running on http://localhost:${PORT}`);
  console.log(`   JWT: ${process.env.JWT_SECRET ? '🔒 Set from .env' : '⚠️  Using default (set JWT_SECRET in .env)'}`);
  console.log(`   AI:  ${process.env.ANTHROPIC_API_KEY ? '🤖 Anthropic key configured' : '⚠️  No ANTHROPIC_API_KEY (AI extraction disabled)'}`);
});
