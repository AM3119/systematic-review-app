"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const auth_1 = __importDefault(require("./routes/auth"));
const reviews_1 = __importDefault(require("./routes/reviews"));
const articles_1 = __importDefault(require("./routes/articles"));
const screening_1 = __importDefault(require("./routes/screening"));
const extraction_1 = __importDefault(require("./routes/extraction"));
const auth_2 = require("./middleware/auth");
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
const ALLOWED_ORIGIN = process.env.FRONTEND_URL || 'http://localhost:5173';
const io = new socket_io_1.Server(httpServer, {
    cors: { origin: ALLOWED_ORIGIN, credentials: true }
});
app.use((0, cors_1.default)({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express_1.default.json({ limit: '20mb' }));
// Routes
app.use('/api/auth', auth_1.default);
app.use('/api/reviews', reviews_1.default);
app.use('/api/reviews', articles_1.default);
app.use('/api/reviews', screening_1.default);
app.use('/api/reviews', extraction_1.default);
// Socket.io for real-time collaboration
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    try {
        const user = jsonwebtoken_1.default.verify(token, auth_2.JWT_SECRET);
        socket.user = user;
        next();
    }
    catch {
        next(new Error('Authentication error'));
    }
});
io.on('connection', (socket) => {
    const user = socket.user;
    socket.on('join-review', (reviewId) => {
        socket.join(`review:${reviewId}`);
        socket.to(`review:${reviewId}`).emit('user-joined', { userId: user.id, name: user.name });
    });
    socket.on('leave-review', (reviewId) => {
        socket.leave(`review:${reviewId}`);
        socket.to(`review:${reviewId}`).emit('user-left', { userId: user.id, name: user.name });
    });
    socket.on('screening-decision', (data) => {
        socket.to(`review:${data.reviewId}`).emit('decision-made', {
            userId: user.id, name: user.name, ...data
        });
    });
    socket.on('typing', (data) => {
        socket.to(`review:${data.reviewId}`).emit('collaborator-typing', { userId: user.id, name: user.name, ...data });
    });
    socket.on('disconnect', () => { });
});
// Make io accessible to routes
app.set('io', io);
// Serve frontend static files in production
const frontendDist = path_1.default.join(__dirname, '../../frontend/dist');
app.use(express_1.default.static(frontendDist));
app.get('*', (_req, res) => {
    res.sendFile(path_1.default.join(frontendDist, 'index.html'));
});
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`SRA running on http://localhost:${PORT}`);
});
