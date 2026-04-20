"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const db_1 = __importStar(require("../db"));
const auth_1 = require("../middleware/auth");
const gamification_1 = require("../utils/gamification");
const router = (0, express_1.Router)();
function reviewAccess(reviewId, userId) {
    return db_1.default.prepare('SELECT role FROM review_members WHERE review_id = ? AND user_id = ?').get(reviewId, userId);
}
// Fields management
router.get('/:reviewId/extraction/fields', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access)
        return res.status(403).json({ error: 'Access denied' });
    const fields = db_1.default.prepare('SELECT * FROM extraction_fields WHERE review_id = ? ORDER BY order_num').all(req.params.reviewId);
    for (const f of fields)
        f.options = JSON.parse(f.options || '[]');
    res.json(fields);
});
router.post('/:reviewId/extraction/fields', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access || !['owner', 'admin'].includes(access.role))
        return res.status(403).json({ error: 'Insufficient permissions' });
    const { field_name, field_label, field_type, options, required, order_num, section } = req.body;
    if (!field_name || !field_label)
        return res.status(400).json({ error: 'field_name and field_label required' });
    const id = (0, uuid_1.v4)();
    db_1.default.prepare(`
    INSERT INTO extraction_fields (id, review_id, field_name, field_label, field_type, options, required, order_num, section)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.reviewId, field_name, field_label, field_type || 'text', JSON.stringify(options || []), required ? 1 : 0, order_num || 0, section || 'General');
    const field = db_1.default.prepare('SELECT * FROM extraction_fields WHERE id = ?').get(id);
    field.options = JSON.parse(field.options);
    res.json(field);
});
router.put('/:reviewId/extraction/fields/:fieldId', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access || !['owner', 'admin'].includes(access.role))
        return res.status(403).json({ error: 'Insufficient permissions' });
    const { field_label, field_type, options, required, order_num, section } = req.body;
    db_1.default.prepare(`
    UPDATE extraction_fields SET field_label = COALESCE(?, field_label), field_type = COALESCE(?, field_type),
    options = COALESCE(?, options), required = COALESCE(?, required), order_num = COALESCE(?, order_num), section = COALESCE(?, section)
    WHERE id = ? AND review_id = ?
  `).run(field_label, field_type, options ? JSON.stringify(options) : null, required !== undefined ? (required ? 1 : 0) : null, order_num, section, req.params.fieldId, req.params.reviewId);
    const field = db_1.default.prepare('SELECT * FROM extraction_fields WHERE id = ?').get(req.params.fieldId);
    if (field)
        field.options = JSON.parse(field.options);
    res.json(field);
});
router.delete('/:reviewId/extraction/fields/:fieldId', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access || !['owner', 'admin'].includes(access.role))
        return res.status(403).json({ error: 'Insufficient permissions' });
    db_1.default.prepare('DELETE FROM extraction_fields WHERE id = ? AND review_id = ?').run(req.params.fieldId, req.params.reviewId);
    res.json({ success: true });
});
router.put('/:reviewId/extraction/fields/reorder', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access || !['owner', 'admin'].includes(access.role))
        return res.status(403).json({ error: 'Insufficient permissions' });
    const { order } = req.body; // array of { id, order_num }
    const update = db_1.default.transaction(() => {
        for (const item of order) {
            db_1.default.prepare('UPDATE extraction_fields SET order_num = ? WHERE id = ? AND review_id = ?').run(item.order_num, item.id, req.params.reviewId);
        }
    });
    update();
    res.json({ success: true });
});
// Data extraction
router.get('/:reviewId/extraction/:articleId', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access)
        return res.status(403).json({ error: 'Access denied' });
    const review = db_1.default.prepare('SELECT blinding_enabled FROM reviews WHERE id = ?').get(req.params.reviewId);
    const blinded = review?.blinding_enabled === 1;
    const uid = req.user.id;
    let query = `
    SELECT ed.*, u.name, u.avatar_color, ef.field_label, ef.field_type, ef.section
    FROM extraction_data ed
    JOIN users u ON ed.user_id = u.id
    JOIN extraction_fields ef ON ed.field_id = ef.id
    WHERE ed.article_id = ? AND ed.review_id = ?
  `;
    const params = [req.params.articleId, req.params.reviewId];
    if (blinded) {
        query += ' AND ed.user_id = ?';
        params.push(uid);
    }
    const data = db_1.default.prepare(query).all(...params);
    res.json(data);
});
router.post('/:reviewId/extraction/:articleId', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access || ['viewer', 'highlighter'].includes(access.role))
        return res.status(403).json({ error: 'Insufficient permissions' });
    const { field_id, value } = req.body;
    if (!field_id)
        return res.status(400).json({ error: 'field_id required' });
    const article = db_1.default.prepare('SELECT id FROM articles WHERE id = ? AND review_id = ?').get(req.params.articleId, req.params.reviewId);
    if (!article)
        return res.status(404).json({ error: 'Article not found' });
    const field = db_1.default.prepare('SELECT id FROM extraction_fields WHERE id = ? AND review_id = ?').get(field_id, req.params.reviewId);
    if (!field)
        return res.status(404).json({ error: 'Field not found' });
    const existing = db_1.default.prepare('SELECT id FROM extraction_data WHERE article_id = ? AND field_id = ? AND user_id = ?')
        .get(req.params.articleId, field_id, req.user.id);
    if (existing) {
        db_1.default.prepare(`UPDATE extraction_data SET value = ?, updated_at = datetime('now') WHERE id = ?`).run(value || '', existing.id);
    }
    else {
        db_1.default.prepare('INSERT INTO extraction_data (id, article_id, review_id, user_id, field_id, value) VALUES (?, ?, ?, ?, ?, ?)')
            .run((0, uuid_1.v4)(), req.params.articleId, req.params.reviewId, req.user.id, field_id, value || '');
        (0, gamification_1.awardPoints)(req.user.id, gamification_1.POINTS.EXTRACT_DATA, req.params.reviewId);
        (0, gamification_1.updateStreak)(req.user.id);
    }
    res.json({ success: true });
});
router.post('/:reviewId/extraction/:articleId/bulk', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access || ['viewer', 'highlighter'].includes(access.role))
        return res.status(403).json({ error: 'Insufficient permissions' });
    const { fields } = req.body; // array of { field_id, value }
    if (!Array.isArray(fields))
        return res.status(400).json({ error: 'fields array required' });
    let newFields = 0;
    (0, db_1.transaction)(() => {
        for (const { field_id, value } of fields) {
            const existing = db_1.default.prepare('SELECT id FROM extraction_data WHERE article_id = ? AND field_id = ? AND user_id = ?')
                .get(req.params.articleId, field_id, req.user.id);
            if (existing) {
                db_1.default.prepare(`UPDATE extraction_data SET value = ?, updated_at = datetime('now') WHERE id = ?`).run(value || '', existing.id);
            }
            else {
                db_1.default.prepare('INSERT INTO extraction_data (id, article_id, review_id, user_id, field_id, value) VALUES (?, ?, ?, ?, ?, ?)')
                    .run((0, uuid_1.v4)(), req.params.articleId, req.params.reviewId, req.user.id, field_id, value || '');
                newFields++;
            }
        }
    });
    if (newFields > 0) {
        (0, gamification_1.awardPoints)(req.user.id, gamification_1.POINTS.EXTRACT_DATA, req.params.reviewId);
        (0, gamification_1.updateStreak)(req.user.id);
    }
    res.json({ success: true, updated: fields.length });
});
// Summary/export
router.get('/:reviewId/extraction/summary', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access)
        return res.status(403).json({ error: 'Access denied' });
    const fields = db_1.default.prepare('SELECT * FROM extraction_fields WHERE review_id = ? ORDER BY order_num').all(req.params.reviewId);
    const includedArticles = db_1.default.prepare(`
    SELECT DISTINCT a.id, a.title, a.authors, a.year, a.journal, a.doi
    FROM articles a
    JOIN screening_decisions sd ON sd.article_id = a.id
    WHERE sd.review_id = ? AND sd.phase = 'fulltext' AND sd.decision = 'include' AND a.is_duplicate_primary = 1
  `).all(req.params.reviewId);
    const result = [];
    for (const article of includedArticles) {
        const extracted = {};
        for (const field of fields) {
            const data = db_1.default.prepare('SELECT value, user_id FROM extraction_data WHERE article_id = ? AND field_id = ?')
                .all(article.id, field.id);
            extracted[field.field_name] = data.length === 1 ? data[0].value : data.map(d => d.value);
        }
        result.push({ ...article, extracted });
    }
    res.json({ fields, articles: result });
});
exports.default = router;
