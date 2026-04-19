"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("uuid");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const gamification_1 = require("../utils/gamification");
const router = (0, express_1.Router)();
router.post('/register', async (req, res) => {
    try {
        const { email, name, password } = req.body;
        if (!email || !name || !password)
            return res.status(400).json({ error: 'All fields required' });
        if (password.length < 6)
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        const existing = db_1.default.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
        if (existing)
            return res.status(409).json({ error: 'Email already registered' });
        const hash = await bcryptjs_1.default.hash(password, 10);
        const id = (0, uuid_1.v4)();
        const colors = ['#4F46E5', '#7C3AED', '#EC4899', '#F59E0B', '#10B981', '#3B82F6', '#EF4444', '#8B5CF6'];
        const avatar_color = colors[Math.floor(Math.random() * colors.length)];
        db_1.default.prepare('INSERT INTO users (id, email, password_hash, name, avatar_color, last_active) VALUES (?, ?, ?, ?, ?, ?)').run(id, email.toLowerCase(), hash, name, avatar_color, new Date().toISOString());
        const token = jsonwebtoken_1.default.sign({ id, email: email.toLowerCase(), name }, auth_1.JWT_SECRET, { expiresIn: '30d' });
        const user = db_1.default.prepare('SELECT id, email, name, avatar_color, points, streak, created_at FROM users WHERE id = ?').get(id);
        res.json({ token, user });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ error: 'Email and password required' });
        const user = db_1.default.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
        if (!user)
            return res.status(401).json({ error: 'Invalid credentials' });
        const valid = await bcryptjs_1.default.compare(password, user.password_hash);
        if (!valid)
            return res.status(401).json({ error: 'Invalid credentials' });
        (0, gamification_1.updateStreak)(user.id);
        db_1.default.prepare('UPDATE users SET last_active = ? WHERE id = ?').run(new Date().toISOString(), user.id);
        const token = jsonwebtoken_1.default.sign({ id: user.id, email: user.email, name: user.name }, auth_1.JWT_SECRET, { expiresIn: '30d' });
        const { password_hash, ...safeUser } = user;
        res.json({ token, user: safeUser });
    }
    catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});
router.get('/me', auth_1.authMiddleware, (req, res) => {
    const user = db_1.default.prepare('SELECT id, email, name, avatar_color, points, streak, last_active, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    res.json(user);
});
router.put('/me', auth_1.authMiddleware, async (req, res) => {
    const { name, currentPassword, newPassword } = req.body;
    const user = db_1.default.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!user)
        return res.status(404).json({ error: 'User not found' });
    if (newPassword) {
        const valid = await bcryptjs_1.default.compare(currentPassword, user.password_hash);
        if (!valid)
            return res.status(401).json({ error: 'Current password incorrect' });
        const hash = await bcryptjs_1.default.hash(newPassword, 10);
        db_1.default.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    }
    if (name)
        db_1.default.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
    const updated = db_1.default.prepare('SELECT id, email, name, avatar_color, points, streak FROM users WHERE id = ?').get(user.id);
    res.json(updated);
});
router.get('/notifications', auth_1.authMiddleware, (req, res) => {
    const notifications = db_1.default.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
    res.json(notifications);
});
router.put('/notifications/read', auth_1.authMiddleware, (req, res) => {
    db_1.default.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ success: true });
});
exports.default = router;
