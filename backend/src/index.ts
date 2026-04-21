import path from 'path';
import fs from 'fs';

// Load .env before anything else
try { require('dotenv').config({ path: path.join(__dirname, '../.env') }); } catch {}

import express from 'express';
import cors from 'cors';
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

const IS_PROD = process.env.NODE_ENV === 'production';

// In production the frontend is served from this same server, so any origin is fine.
// In dev, allow the Vite dev server.
const ALLOWED_ORIGIN = IS_PROD ? '*' : (process.env.FRONTEND_URL || 'http://localhost:5173');

const io = new SocketServer(httpServer, {
  cors: { origin: ALLOWED_ORIGIN, credentials: !IS_PROD }
});

app.use(cors({ origin: ALLOWED_ORIGIN, credentials: !IS_PROD }));
app.use(express.json({ limit: '20mb' }));

// Serve uploaded PDFs from the persistent data directory
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const PDF_DIR = path.join(DATA_DIR, 'pdfs');
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });
app.use('/api/pdfs', express.static(PDF_DIR));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/reviews', articleRoutes);
app.use('/api/reviews', screeningRoutes);
app.use('/api/reviews', extractionRoutes);

// In production: serve the frontend SPA for all non-API routes
if (IS_PROD) {
  const frontendDist = path.join(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get('*', (req: express.Request, res: express.Response) => res.sendFile(path.join(frontendDist, 'index.html')));
  }
}

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
  console.log(`   AI:  🦙 Ollama (${process.env.OLLAMA_MODEL || 'llama3.2'}) at ${process.env.OLLAMA_URL || 'http://localhost:11434'}`);
});
