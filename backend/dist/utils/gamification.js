"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BADGES = exports.POINTS = void 0;
exports.awardPoints = awardPoints;
exports.updateStreak = updateStreak;
exports.getUserMetrics = getUserMetrics;
exports.checkAndAwardBadges = checkAndAwardBadges;
exports.createNotification = createNotification;
const db_1 = __importDefault(require("../db"));
const uuid_1 = require("uuid");
exports.POINTS = {
    SCREEN_ABSTRACT: 2,
    SCREEN_FULLTEXT: 5,
    EXTRACT_DATA: 10,
    MARK_DUPLICATE: 3,
    COMPLETE_REVIEW_PHASE: 50,
    DAILY_STREAK_BONUS: 5,
    FIRST_CONTRIBUTION: 20,
    RESOLVE_CONFLICT: 15,
};
exports.BADGES = [
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
function awardPoints(userId, points, reviewId) {
    db_1.default.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(points, userId);
    if (reviewId) {
        db_1.default.prepare(`INSERT INTO audit_log (id, review_id, user_id, action, details) VALUES (?, ?, ?, 'points_awarded', ?)`).run((0, uuid_1.v4)(), reviewId, userId, JSON.stringify({ points }));
    }
    checkAndAwardBadges(userId, reviewId);
}
function updateStreak(userId) {
    const user = db_1.default.prepare('SELECT last_active, streak FROM users WHERE id = ?').get(userId);
    if (!user)
        return;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const lastActive = user.last_active ? user.last_active.split('T')[0] : null;
    if (lastActive === today)
        return;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    let newStreak = lastActive === yesterdayStr ? (user.streak || 0) + 1 : 1;
    db_1.default.prepare('UPDATE users SET streak = ?, last_active = ? WHERE id = ?').run(newStreak, now.toISOString(), userId);
    if (newStreak > 1) {
        awardPoints(userId, exports.POINTS.DAILY_STREAK_BONUS);
    }
}
function getUserMetrics(userId) {
    const abstracts = db_1.default.prepare(`SELECT COUNT(*) as count FROM screening_decisions WHERE user_id = ? AND phase = 'abstract'`).get(userId)?.count || 0;
    const fulltext = db_1.default.prepare(`SELECT COUNT(*) as count FROM screening_decisions WHERE user_id = ? AND phase = 'fulltext'`).get(userId)?.count || 0;
    const extractions = db_1.default.prepare(`SELECT COUNT(DISTINCT article_id) as count FROM extraction_data WHERE user_id = ?`).get(userId)?.count || 0;
    const user = db_1.default.prepare('SELECT points, streak FROM users WHERE id = ?').get(userId);
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
function checkAndAwardBadges(userId, reviewId) {
    const metrics = getUserMetrics(userId);
    const existingBadges = db_1.default.prepare('SELECT badge_type FROM badges WHERE user_id = ?').all(userId);
    const existingTypes = new Set(existingBadges.map((b) => b.badge_type));
    for (const badge of exports.BADGES) {
        if (existingTypes.has(badge.type))
            continue;
        const value = metrics[badge.metric] || 0;
        if (value >= badge.threshold) {
            db_1.default.prepare('INSERT INTO badges (id, user_id, review_id, badge_type, badge_name, description) VALUES (?, ?, ?, ?, ?, ?)').run((0, uuid_1.v4)(), userId, reviewId || null, badge.type, badge.name, badge.description);
            if (reviewId) {
                createNotification(userId, 'badge', `You earned the "${badge.name}" badge! ${badge.description}`, reviewId);
            }
        }
    }
}
function createNotification(userId, type, message, reviewId) {
    db_1.default.prepare('INSERT INTO notifications (id, user_id, type, message, review_id) VALUES (?, ?, ?, ?, ?)').run((0, uuid_1.v4)(), userId, type, message, reviewId || null);
}
