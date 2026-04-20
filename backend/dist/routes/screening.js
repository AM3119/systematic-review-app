"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const gamification_1 = require("../utils/gamification");
const router = (0, express_1.Router)();
function reviewAccess(reviewId, userId) {
    return db_1.default.prepare('SELECT role FROM review_members WHERE review_id = ? AND user_id = ?').get(reviewId, userId);
}
function checkConflicts(articleId, reviewId, phase) {
    const decisions = db_1.default.prepare(`
    SELECT sd.decision, sd.user_id FROM screening_decisions sd
    JOIN review_members rm ON rm.user_id = sd.user_id AND rm.review_id = ?
    WHERE sd.article_id = ? AND sd.phase = ? AND rm.role IN ('owner', 'admin', 'reviewer')
  `).all(reviewId, articleId, phase);
    if (decisions.length < 2)
        return false;
    const uniqueDecisions = new Set(decisions.map((d) => d.decision));
    return uniqueDecisions.size > 1;
}
router.post('/:reviewId/screen', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access || ['viewer'].includes(access.role))
        return res.status(403).json({ error: 'Insufficient permissions' });
    const { article_id, phase, decision, reason, notes, time_spent } = req.body;
    if (!article_id || !phase || !decision)
        return res.status(400).json({ error: 'article_id, phase, and decision required' });
    if (!['abstract', 'fulltext'].includes(phase))
        return res.status(400).json({ error: 'Phase must be abstract or fulltext' });
    if (!['include', 'exclude', 'maybe'].includes(decision))
        return res.status(400).json({ error: 'Decision must be include, exclude, or maybe' });
    const article = db_1.default.prepare('SELECT id FROM articles WHERE id = ? AND review_id = ?').get(article_id, req.params.reviewId);
    if (!article)
        return res.status(404).json({ error: 'Article not found in this review' });
    const existing = db_1.default.prepare('SELECT id FROM screening_decisions WHERE article_id = ? AND user_id = ? AND phase = ?')
        .get(article_id, req.user.id, phase);
    const id = existing ? existing.id : (0, uuid_1.v4)();
    if (existing) {
        db_1.default.prepare(`
      UPDATE screening_decisions SET decision = ?, reason = ?, notes = ?, time_spent = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(decision, reason || '', notes || '', time_spent || 0, id);
    }
    else {
        db_1.default.prepare(`
      INSERT INTO screening_decisions (id, article_id, review_id, user_id, phase, decision, reason, notes, time_spent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, article_id, req.params.reviewId, req.user.id, phase, decision, reason || '', notes || '', time_spent || 0);
        const pts = phase === 'abstract' ? gamification_1.POINTS.SCREEN_ABSTRACT : gamification_1.POINTS.SCREEN_FULLTEXT;
        (0, gamification_1.awardPoints)(req.user.id, pts, req.params.reviewId);
        (0, gamification_1.updateStreak)(req.user.id);
    }
    // Check for conflicts
    const hasConflict = checkConflicts(article_id, req.params.reviewId, phase);
    if (hasConflict) {
        const existingConflict = db_1.default.prepare('SELECT id FROM conflicts WHERE article_id = ? AND review_id = ? AND phase = ? AND resolved = 0')
            .get(article_id, req.params.reviewId, phase);
        if (!existingConflict) {
            db_1.default.prepare('INSERT INTO conflicts (id, article_id, review_id, phase) VALUES (?, ?, ?, ?)')
                .run((0, uuid_1.v4)(), article_id, req.params.reviewId, phase);
        }
        // Notify review owner/admins
        const admins = db_1.default.prepare(`
      SELECT user_id FROM review_members WHERE review_id = ? AND role IN ('owner', 'admin') AND user_id != ?
    `).all(req.params.reviewId, req.user.id);
        for (const admin of admins) {
            (0, gamification_1.createNotification)(admin.user_id, 'conflict', `Screening conflict detected in phase: ${phase}`, req.params.reviewId);
        }
    }
    res.json({ id, decision, has_conflict: hasConflict });
});
router.get('/:reviewId/screen/progress', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access)
        return res.status(403).json({ error: 'Access denied' });
    const uid = req.user.id;
    const rid = req.params.reviewId;
    const totalArticles = db_1.default.prepare('SELECT COUNT(*) as c FROM articles WHERE review_id = ? AND is_duplicate_primary = 1').get(rid)?.c || 0;
    const myAbstract = db_1.default.prepare(`SELECT COUNT(*) as c FROM screening_decisions WHERE review_id = ? AND user_id = ? AND phase = 'abstract'`).get(rid, uid)?.c || 0;
    const myFulltext = db_1.default.prepare(`SELECT COUNT(*) as c FROM screening_decisions WHERE review_id = ? AND user_id = ? AND phase = 'fulltext'`).get(rid, uid)?.c || 0;
    // For my next unscreened article
    const nextAbstract = db_1.default.prepare(`
    SELECT a.id FROM articles a
    WHERE a.review_id = ? AND a.is_duplicate_primary = 1
    AND NOT EXISTS (SELECT 1 FROM screening_decisions sd WHERE sd.article_id = a.id AND sd.user_id = ? AND sd.phase = 'abstract')
    LIMIT 1
  `).get(rid, uid);
    const nextFulltext = db_1.default.prepare(`
    SELECT a.id FROM articles a
    WHERE a.review_id = ? AND a.is_duplicate_primary = 1
    AND EXISTS (SELECT 1 FROM screening_decisions sd WHERE sd.article_id = a.id AND sd.user_id = ? AND sd.phase = 'abstract' AND sd.decision = 'include')
    AND NOT EXISTS (SELECT 1 FROM screening_decisions sd WHERE sd.article_id = a.id AND sd.user_id = ? AND sd.phase = 'fulltext')
    LIMIT 1
  `).get(rid, uid, uid);
    const conflicts = db_1.default.prepare('SELECT COUNT(*) as c FROM conflicts WHERE review_id = ? AND resolved = 0').get(rid)?.c || 0;
    res.json({
        total_articles: totalArticles,
        my_abstract_screened: myAbstract,
        my_fulltext_screened: myFulltext,
        abstract_pct: totalArticles > 0 ? Math.round(myAbstract / totalArticles * 100) : 0,
        fulltext_pct: totalArticles > 0 ? Math.round(myFulltext / totalArticles * 100) : 0,
        next_abstract_id: nextAbstract?.id || null,
        next_fulltext_id: nextFulltext?.id || null,
        conflicts,
    });
});
router.get('/:reviewId/conflicts', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access)
        return res.status(403).json({ error: 'Access denied' });
    const conflicts = db_1.default.prepare(`
    SELECT c.*, a.title, a.authors, a.abstract, a.journal, a.year,
      json_group_array(json_object('user_id', sd.user_id, 'name', u.name, 'decision', sd.decision, 'reason', sd.reason, 'avatar_color', u.avatar_color)) as decisions
    FROM conflicts c
    JOIN articles a ON c.article_id = a.id
    JOIN screening_decisions sd ON sd.article_id = c.article_id AND sd.phase = c.phase
    JOIN users u ON sd.user_id = u.id
    WHERE c.review_id = ? AND c.resolved = 0
    GROUP BY c.id
  `).all(req.params.reviewId);
    for (const c of conflicts)
        c.decisions = JSON.parse(c.decisions);
    res.json(conflicts);
});
router.post('/:reviewId/conflicts/:conflictId/resolve', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access || !['owner', 'admin'].includes(access.role))
        return res.status(403).json({ error: 'Insufficient permissions' });
    const { resolution, final_decision, reason } = req.body;
    const conflict = db_1.default.prepare('SELECT * FROM conflicts WHERE id = ? AND review_id = ?').get(req.params.conflictId, req.params.reviewId);
    if (!conflict)
        return res.status(404).json({ error: 'Conflict not found' });
    db_1.default.prepare(`UPDATE conflicts SET resolved = 1, resolution = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`)
        .run(resolution || '', req.user.id, req.params.conflictId);
    if (final_decision) {
        const existing = db_1.default.prepare('SELECT id FROM screening_decisions WHERE article_id = ? AND user_id = ? AND phase = ?')
            .get(conflict.article_id, req.user.id, conflict.phase);
        if (existing) {
            db_1.default.prepare(`UPDATE screening_decisions SET decision = ?, reason = ?, updated_at = datetime('now') WHERE id = ?`)
                .run(final_decision, reason || 'Resolved conflict', existing.id);
        }
        else {
            db_1.default.prepare('INSERT INTO screening_decisions (id, article_id, review_id, user_id, phase, decision, reason) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run((0, uuid_1.v4)(), conflict.article_id, req.params.reviewId, req.user.id, conflict.phase, final_decision, reason || 'Resolved conflict');
        }
        (0, gamification_1.awardPoints)(req.user.id, gamification_1.POINTS.RESOLVE_CONFLICT, req.params.reviewId);
    }
    res.json({ success: true });
});
router.get('/:reviewId/decisions', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access)
        return res.status(403).json({ error: 'Access denied' });
    const review = db_1.default.prepare('SELECT blinding_enabled FROM reviews WHERE id = ?').get(req.params.reviewId);
    const blinded = review?.blinding_enabled === 1;
    const uid = req.user.id;
    let query = `
    SELECT sd.*, u.name, u.avatar_color, a.title, a.authors, a.year, a.journal
    FROM screening_decisions sd
    JOIN users u ON sd.user_id = u.id
    JOIN articles a ON sd.article_id = a.id
    WHERE sd.review_id = ?
  `;
    const params = [req.params.reviewId];
    if (blinded) {
        query += ' AND sd.user_id = ?';
        params.push(uid);
    }
    if (req.query.phase) {
        query += ' AND sd.phase = ?';
        params.push(req.query.phase);
    }
    query += ' ORDER BY sd.updated_at DESC LIMIT 100';
    res.json(db_1.default.prepare(query).all(...params));
});
exports.default = router;
