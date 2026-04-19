import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { JWT_SECRET, authMiddleware, AuthRequest } from '../middleware/auth';
import { updateStreak } from '../utils/gamification';

const router = Router();

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, name, password } = req.body;
    if (!email || !name || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const colors = ['#4F46E5', '#7C3AED', '#EC4899', '#F59E0B', '#10B981', '#3B82F6', '#EF4444', '#8B5CF6'];
    const avatar_color = colors[Math.floor(Math.random() * colors.length)];

    db.prepare(
      'INSERT INTO users (id, email, password_hash, name, avatar_color, last_active) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, email.toLowerCase(), hash, name, avatar_color, new Date().toISOString());

    const token = jwt.sign({ id, email: email.toLowerCase(), name }, JWT_SECRET, { expiresIn: '30d' });
    const user = db.prepare('SELECT id, email, name, avatar_color, points, streak, created_at FROM users WHERE id = ?').get(id);
    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as any;
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    updateStreak(user.id);
    db.prepare('UPDATE users SET last_active = ? WHERE id = ?').run(new Date().toISOString(), user.id);

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
    const { password_hash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', authMiddleware, (req: AuthRequest, res: Response) => {
  const user = db.prepare(
    'SELECT id, email, name, avatar_color, points, streak, last_active, created_at FROM users WHERE id = ?'
  ).get(req.user!.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.put('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { name, currentPassword, newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (newPassword) {
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  }

  if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);

  const updated = db.prepare('SELECT id, email, name, avatar_color, points, streak FROM users WHERE id = ?').get(user.id);
  res.json(updated);
});

router.get('/notifications', authMiddleware, (req: AuthRequest, res: Response) => {
  const notifications = db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(req.user!.id);
  res.json(notifications);
});

router.put('/notifications/read', authMiddleware, (req: AuthRequest, res: Response) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user!.id);
  res.json({ success: true });
});

export default router;
