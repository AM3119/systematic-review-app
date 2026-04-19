import db from '../db';
import { v4 as uuidv4 } from 'uuid';

export const POINTS = {
  SCREEN_ABSTRACT: 2,
  SCREEN_FULLTEXT: 5,
  EXTRACT_DATA: 10,
  MARK_DUPLICATE: 3,
  COMPLETE_REVIEW_PHASE: 50,
  DAILY_STREAK_BONUS: 5,
  FIRST_CONTRIBUTION: 20,
  RESOLVE_CONFLICT: 15,
};

export const BADGES = [
  { type: 'first_screen', name: 'First Screen', description: 'Screened your first abstract', threshold: 1, metric: 'abstracts_screened' },
  { type: 'speed_screener', name: 'Speed Screener', description: 'Screened 50 abstracts', threshold: 50, metric: 'abstracts_screened' },
  { type: 'expert_screener', name: 'Expert Screener', description: 'Screened 200 abstracts', threshold: 200, metric: 'abstracts_screened' },
  { type: 'fulltext_hero', name: 'Full-Text Hero', description: 'Completed 25 full-text reviews', threshold: 25, metric: 'fulltext_screened' },
  { type: 'data_extractor', name: 'Data Extractor', description: 'Completed 10 data extractions', threshold: 10, metric: 'extractions_done' },
  { type: 'duplicate_hunter', name: 'Duplicate Hunter', description: 'Identified 20 duplicates', threshold: 20, metric: 'duplicates_found' },
  { type: 'week_streak', name: '7-Day Streak', description: 'Active 7 days in a row', threshold: 7, metric: 'streak' },
  { type: 'month_streak', name: '30-Day Streak', description: 'Active 30 days in a row', threshold: 30, metric: 'streak' },
  { type: 'conflict_resolver', name: 'Conflict Resolver', description: 'Resolved 5 screening conflicts', threshold: 5, metric: 'conflicts_resolved' },
  { type: 'century_club', name: 'Century Club', description: 'Earned 100 points', threshold: 100, metric: 'points' },
  { type: 'thousand_club', name: 'Thousand Club', description: 'Earned 1000 points', threshold: 1000, metric: 'points' },
];

export function awardPoints(userId: string, points: number, reviewId?: string) {
  db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(points, userId);

  if (reviewId) {
    db.prepare(`INSERT INTO audit_log (id, review_id, user_id, action, details) VALUES (?, ?, ?, 'points_awarded', ?)`).run(
      uuidv4(), reviewId, userId, JSON.stringify({ points })
    );
  }
  checkAndAwardBadges(userId, reviewId);
}

export function updateStreak(userId: string) {
  const user = db.prepare('SELECT last_active, streak FROM users WHERE id = ?').get(userId) as any;
  if (!user) return;

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const lastActive = user.last_active ? user.last_active.split('T')[0] : null;

  if (lastActive === today) return;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  let newStreak = lastActive === yesterdayStr ? (user.streak || 0) + 1 : 1;

  db.prepare('UPDATE users SET streak = ?, last_active = ? WHERE id = ?').run(
    newStreak, now.toISOString(), userId
  );

  if (newStreak > 1) {
    awardPoints(userId, POINTS.DAILY_STREAK_BONUS);
  }
}

export function getUserMetrics(userId: string) {
  const abstracts = (db.prepare(
    `SELECT COUNT(*) as count FROM screening_decisions WHERE user_id = ? AND phase = 'abstract'`
  ).get(userId) as any)?.count || 0;

  const fulltext = (db.prepare(
    `SELECT COUNT(*) as count FROM screening_decisions WHERE user_id = ? AND phase = 'fulltext'`
  ).get(userId) as any)?.count || 0;

  const extractions = (db.prepare(
    `SELECT COUNT(DISTINCT article_id) as count FROM extraction_data WHERE user_id = ?`
  ).get(userId) as any)?.count || 0;

  const user = db.prepare('SELECT points, streak FROM users WHERE id = ?').get(userId) as any;

  return {
    abstracts_screened: abstracts,
    fulltext_screened: fulltext,
    extractions_done: extractions,
    duplicates_found: 0,
    conflicts_resolved: 0,
    points: user?.points || 0,
    streak: user?.streak || 0,
  };
}

export function checkAndAwardBadges(userId: string, reviewId?: string) {
  const metrics = getUserMetrics(userId);
  const existingBadges = db.prepare('SELECT badge_type FROM badges WHERE user_id = ?').all(userId) as any[];
  const existingTypes = new Set(existingBadges.map((b: any) => b.badge_type));

  for (const badge of BADGES) {
    if (existingTypes.has(badge.type)) continue;
    const value = (metrics as any)[badge.metric] || 0;
    if (value >= badge.threshold) {
      db.prepare(
        'INSERT INTO badges (id, user_id, review_id, badge_type, badge_name, description) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(uuidv4(), userId, reviewId || null, badge.type, badge.name, badge.description);
      if (reviewId) {
        createNotification(userId, 'badge', `You earned the "${badge.name}" badge! ${badge.description}`, reviewId);
      }
    }
  }
}

export function createNotification(userId: string, type: string, message: string, reviewId?: string) {
  db.prepare(
    'INSERT INTO notifications (id, user_id, type, message, review_id) VALUES (?, ?, ?, ?, ?)'
  ).run(uuidv4(), userId, type, message, reviewId || null);
}
