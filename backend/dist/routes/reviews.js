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
    return db_1.default.prepare('SELECT rm.role FROM review_members rm WHERE rm.review_id = ? AND rm.user_id = ?').get(reviewId, userId);
}
router.get('/', auth_1.authMiddleware, (req, res) => {
    const reviews = db_1.default.prepare(`
    SELECT r.*, u.name as owner_name, u.avatar_color as owner_color,
      (SELECT COUNT(*) FROM review_members WHERE review_id = r.id) as member_count,
      (SELECT COUNT(*) FROM articles WHERE review_id = r.id AND is_duplicate_primary = 1) as article_count,
      rm.role as my_role
    FROM reviews r
    JOIN users u ON r.owner_id = u.id
    JOIN review_members rm ON rm.review_id = r.id AND rm.user_id = ?
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `).all(req.user.id);
    res.json(reviews);
});
router.post('/', auth_1.authMiddleware, (req, res) => {
    const { title, description, inclusion_criteria, exclusion_criteria, keywords, blinding_enabled } = req.body;
    if (!title)
        return res.status(400).json({ error: 'Title required' });
    const id = (0, uuid_1.v4)();
    db_1.default.prepare(`
    INSERT INTO reviews (id, title, description, owner_id, inclusion_criteria, exclusion_criteria, keywords, blinding_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, description || '', req.user.id, inclusion_criteria || '', exclusion_criteria || '', JSON.stringify(keywords || []), blinding_enabled !== false ? 1 : 0);
    db_1.default.prepare('INSERT INTO review_members (id, review_id, user_id, role) VALUES (?, ?, ?, ?)').run((0, uuid_1.v4)(), id, req.user.id, 'owner');
    const defaultFields = [
        { name: 'study_design', label: 'Study Design', type: 'select', options: ['RCT', 'Cohort', 'Case-Control', 'Cross-Sectional', 'Systematic Review', 'Meta-Analysis', 'Other'], section: 'Study Characteristics' },
        { name: 'population', label: 'Population/Sample', type: 'textarea', options: [], section: 'Study Characteristics' },
        { name: 'intervention', label: 'Intervention/Exposure', type: 'textarea', options: [], section: 'Study Characteristics' },
        { name: 'comparator', label: 'Comparator/Control', type: 'text', options: [], section: 'Study Characteristics' },
        { name: 'outcomes', label: 'Outcomes Measured', type: 'textarea', options: [], section: 'Results' },
        { name: 'sample_size', label: 'Sample Size', type: 'number', options: [], section: 'Results' },
        { name: 'follow_up', label: 'Follow-up Duration', type: 'text', options: [], section: 'Results' },
        { name: 'main_results', label: 'Main Results', type: 'textarea', options: [], section: 'Results' },
        { name: 'risk_of_bias', label: 'Risk of Bias', type: 'select', options: ['Low', 'Moderate', 'High', 'Unclear'], section: 'Quality Assessment' },
        { name: 'notes', label: 'Reviewer Notes', type: 'textarea', options: [], section: 'Notes' },
    ];
    for (let i = 0; i < defaultFields.length; i++) {
        const f = defaultFields[i];
        db_1.default.prepare('INSERT INTO extraction_fields (id, review_id, field_name, field_label, field_type, options, order_num, section) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run((0, uuid_1.v4)(), id, f.name, f.label, f.type, JSON.stringify(f.options), i, f.section);
    }
    const review = db_1.default.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
    res.json(review);
});
router.get('/:id', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.id, req.user.id);
    if (!access)
        return res.status(403).json({ error: 'Access denied' });
    const review = db_1.default.prepare(`
    SELECT r.*, u.name as owner_name, u.avatar_color as owner_color, rm.role as my_role
    FROM reviews r JOIN users u ON r.owner_id = u.id
    JOIN review_members rm ON rm.review_id = r.id AND rm.user_id = ?
    WHERE r.id = ?
  `).get(req.user.id, req.params.id);
    if (!review)
        return res.status(404).json({ error: 'Review not found' });
    res.json(review);
});
router.put('/:id', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.id, req.user.id);
    if (!access || !['owner', 'admin'].includes(access.role))
        return res.status(403).json({ error: 'Insufficient permissions' });
    const { title, description, inclusion_criteria, exclusion_criteria, keywords, blinding_enabled, status } = req.body;
    db_1.default.prepare(`
    UPDATE reviews SET title = COALESCE(?, title), description = COALESCE(?, description),
    inclusion_criteria = COALESCE(?, inclusion_criteria), exclusion_criteria = COALESCE(?, exclusion_criteria),
    keywords = COALESCE(?, keywords), blinding_enabled = COALESCE(?, blinding_enabled), status = COALESCE(?, status)
    WHERE id = ?
  `).run(title, description, inclusion_criteria, exclusion_criteria, keywords ? JSON.stringify(keywords) : null, blinding_enabled !== undefined ? (blinding_enabled ? 1 : 0) : null, status, req.params.id);
    res.json(db_1.default.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id));
});
router.delete('/:id', auth_1.authMiddleware, (req, res) => {
    const review = db_1.default.prepare('SELECT * FROM reviews WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
    if (!review)
        return res.status(403).json({ error: 'Only owner can delete review' });
    db_1.default.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});
// Stats
router.get('/:id/stats', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.id, req.user.id);
    if (!access)
        return res.status(403).json({ error: 'Access denied' });
    const rid = req.params.id;
    const total = db_1.default.prepare('SELECT COUNT(*) as c FROM articles WHERE review_id = ?').get(rid)?.c || 0;
    const duplicates = db_1.default.prepare('SELECT COUNT(*) as c FROM articles WHERE review_id = ? AND is_duplicate_primary = 0').get(rid)?.c || 0;
    const unique = total - duplicates;
    const abstractStats = db_1.default.prepare(`
    SELECT decision, COUNT(*) as count FROM screening_decisions
    WHERE review_id = ? AND phase = 'abstract' GROUP BY decision
  `).all(rid);
    const fulltextStats = db_1.default.prepare(`
    SELECT decision, COUNT(*) as count FROM screening_decisions
    WHERE review_id = ? AND phase = 'fulltext' GROUP BY decision
  `).all(rid);
    const abstractDecisions = {};
    for (const row of abstractStats)
        abstractDecisions[row.decision] = row.count;
    const fulltextDecisions = {};
    for (const row of fulltextStats)
        fulltextDecisions[row.decision] = row.count;
    const screened = db_1.default.prepare(`
    SELECT COUNT(DISTINCT article_id) as c FROM screening_decisions WHERE review_id = ? AND phase = 'abstract'
  `).get(rid)?.c || 0;
    const memberActivity = db_1.default.prepare(`
    SELECT u.name, u.avatar_color, COUNT(sd.id) as decisions, u.points, u.streak
    FROM review_members rm
    JOIN users u ON rm.user_id = u.id
    LEFT JOIN screening_decisions sd ON sd.user_id = u.id AND sd.review_id = ?
    WHERE rm.review_id = ?
    GROUP BY u.id ORDER BY decisions DESC
  `).all(rid, rid);
    const conflicts = db_1.default.prepare(`
    SELECT COUNT(*) as c FROM conflicts WHERE review_id = ? AND resolved = 0
  `).get(rid)?.c || 0;
    res.json({
        total, duplicates, unique,
        abstractDecisions, fulltextDecisions,
        screened, screened_pct: unique > 0 ? Math.round(screened / unique * 100) : 0,
        included_abstract: abstractDecisions['include'] || 0,
        excluded_abstract: abstractDecisions['exclude'] || 0,
        maybe_abstract: abstractDecisions['maybe'] || 0,
        included_fulltext: fulltextDecisions['include'] || 0,
        excluded_fulltext: fulltextDecisions['exclude'] || 0,
        memberActivity, conflicts
    });
});
// Members
router.get('/:id/members', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.id, req.user.id);
    if (!access)
        return res.status(403).json({ error: 'Access denied' });
    const members = db_1.default.prepare(`
    SELECT rm.id, rm.role, rm.joined_at, u.id as user_id, u.name, u.email, u.avatar_color, u.points, u.streak,
      (SELECT COUNT(*) FROM screening_decisions sd WHERE sd.user_id = u.id AND sd.review_id = rm.review_id) as decisions_made
    FROM review_members rm JOIN users u ON rm.user_id = u.id
    WHERE rm.review_id = ? ORDER BY rm.joined_at
  `).all(req.params.id);
    res.json(members);
});
router.post('/:id/invite', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.id, req.user.id);
    if (!access || !['owner', 'admin'].includes(access.role))
        return res.status(403).json({ error: 'Insufficient permissions' });
    const { email, role } = req.body;
    const invitee = db_1.default.prepare('SELECT id, name FROM users WHERE email = ?').get(email?.toLowerCase());
    if (!invitee) {
        const token = (0, uuid_1.v4)();
        db_1.default.prepare('INSERT OR REPLACE INTO review_invites (id, review_id, email, role, token, invited_by) VALUES (?, ?, ?, ?, ?, ?)')
            .run((0, uuid_1.v4)(), req.params.id, email.toLowerCase(), role || 'reviewer', token, req.user.id);
        return res.json({ invited: true, pending: true, token, message: `Invite link created for ${email}` });
    }
    const existing = reviewAccess(req.params.id, invitee.id);
    if (existing)
        return res.status(409).json({ error: 'User already a member' });
    db_1.default.prepare('INSERT INTO review_members (id, review_id, user_id, role, invited_by) VALUES (?, ?, ?, ?, ?)')
        .run((0, uuid_1.v4)(), req.params.id, invitee.id, role || 'reviewer', req.user.id);
    const review = db_1.default.prepare('SELECT title FROM reviews WHERE id = ?').get(req.params.id);
    (0, gamification_1.createNotification)(invitee.id, 'invite', `You've been added to the review: "${review?.title}"`, req.params.id);
    res.json({ invited: true, pending: false, user: invitee });
});
router.post('/:id/join', auth_1.authMiddleware, (req, res) => {
    const { token } = req.body;
    const invite = db_1.default.prepare('SELECT * FROM review_invites WHERE token = ? AND review_id = ?').get(token, req.params.id);
    if (!invite)
        return res.status(404).json({ error: 'Invalid invite token' });
    const existing = reviewAccess(req.params.id, req.user.id);
    if (existing)
        return res.status(409).json({ error: 'Already a member' });
    db_1.default.prepare('INSERT INTO review_members (id, review_id, user_id, role, invited_by) VALUES (?, ?, ?, ?, ?)')
        .run((0, uuid_1.v4)(), req.params.id, req.user.id, invite.role, invite.invited_by);
    db_1.default.prepare('DELETE FROM review_invites WHERE id = ?').run(invite.id);
    res.json({ success: true });
});
router.delete('/:id/members/:userId', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.id, req.user.id);
    const isRemovingSelf = req.params.userId === req.user.id;
    if (!access || (!isRemovingSelf && !['owner', 'admin'].includes(access.role))) {
        return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const target = reviewAccess(req.params.id, req.params.userId);
    if (target?.role === 'owner')
        return res.status(400).json({ error: 'Cannot remove owner' });
    db_1.default.prepare('DELETE FROM review_members WHERE review_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
    res.json({ success: true });
});
router.put('/:id/members/:userId/role', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.id, req.user.id);
    if (!access || access.role !== 'owner')
        return res.status(403).json({ error: 'Only owner can change roles' });
    const { role } = req.body;
    if (!['admin', 'reviewer', 'highlighter', 'viewer'].includes(role))
        return res.status(400).json({ error: 'Invalid role' });
    db_1.default.prepare('UPDATE review_members SET role = ? WHERE review_id = ? AND user_id = ?').run(role, req.params.id, req.params.userId);
    res.json({ success: true });
});
// Leaderboard
router.get('/:id/leaderboard', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.id, req.user.id);
    if (!access)
        return res.status(403).json({ error: 'Access denied' });
    const leaders = db_1.default.prepare(`
    SELECT u.id, u.name, u.avatar_color, u.points, u.streak,
      (SELECT COUNT(*) FROM screening_decisions WHERE user_id = u.id AND review_id = ? AND phase = 'abstract') as abstracts,
      (SELECT COUNT(*) FROM screening_decisions WHERE user_id = u.id AND review_id = ? AND phase = 'fulltext') as fulltexts,
      (SELECT COUNT(DISTINCT article_id) FROM extraction_data WHERE user_id = u.id AND review_id = ?) as extractions,
      (SELECT COUNT(*) FROM badges WHERE user_id = u.id) as badge_count
    FROM review_members rm JOIN users u ON rm.user_id = u.id
    WHERE rm.review_id = ?
    ORDER BY abstracts + fulltexts * 2 + extractions * 4 DESC
  `).all(req.params.id, req.params.id, req.params.id, req.params.id);
    res.json(leaders);
});
// Badges
router.get('/:id/badges', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.id, req.user.id);
    if (!access)
        return res.status(403).json({ error: 'Access denied' });
    const badges = db_1.default.prepare(`
    SELECT b.*, u.name, u.avatar_color FROM badges b
    JOIN users u ON b.user_id = u.id
    WHERE b.review_id = ? OR b.review_id IS NULL AND b.user_id IN (
      SELECT user_id FROM review_members WHERE review_id = ?
    )
    ORDER BY b.earned_at DESC
  `).all(req.params.id, req.params.id);
    res.json(badges);
});
exports.default = router;
