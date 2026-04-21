"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JWT_SECRET = void 0;
exports.authMiddleware = authMiddleware;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// Load .env in development
try {
    require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
}
catch { }
exports.JWT_SECRET = process.env.JWT_SECRET || 'sra-super-secret-key-change-in-production';
if (!process.env.JWT_SECRET)
    console.warn('⚠️  JWT_SECRET not set in .env — using insecure default. Set it before deploying!');
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token)
        return res.status(401).json({ error: 'No token provided' });
    try {
        const decoded = jsonwebtoken_1.default.verify(token, exports.JWT_SECRET);
        req.user = decoded;
        next();
    }
    catch {
        return res.status(401).json({ error: 'Invalid token' });
    }
}
