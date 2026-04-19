import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db, { transaction } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { awardPoints, updateStreak, POINTS } from '../utils/gamification';

const router = Router();

function reviewAccess(reviewId: string, userId: string) {
  return db.prepare('SELECT role FROM review_members WHERE review_id = ? AND user_id = ?').get(reviewId, userId) as { role: string } | undefined;
}

// Fields management
router.get('/:reviewId/extraction/fields', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access) return res.status(403).json({ error: 'Access denied' });

  const fields = db.prepare('SELECT * FROM extraction_fields WHERE review_id = ? ORDER BY order_num').all(req.params.reviewId) as any[];
  for (const f of fields) f.options = JSON.parse(f.options || '[]');
  res.json(fields);
});

router.post('/:reviewId/extraction/fields', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || !['owner', 'admin'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { field_name, field_label, field_type, options, required, order_num, section } = req.body;
  if (!field_name || !field_label) return res.status(400).json({ error: 'field_name and field_label required' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO extraction_fields (id, review_id, field_name, field_label, field_type, options, required, order_num, section)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.reviewId, field_name, field_label, field_type || 'text', JSON.stringify(options || []),
    required ? 1 : 0, order_num || 0, section || 'General');

  const field = db.prepare('SELECT * FROM extraction_fields WHERE id = ?').get(id) as any;
  field.options = JSON.parse(field.options);
  res.json(field);
});

router.put('/:reviewId/extraction/fields/:fieldId', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || !['owner', 'admin'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { field_label, field_type, options, required, order_num, section } = req.body;
  db.prepare(`
    UPDATE extraction_fields SET field_label = COALESCE(?, field_label), field_type = COALESCE(?, field_type),
    options = COALESCE(?, options), required = COALESCE(?, required), order_num = COALESCE(?, order_num), section = COALESCE(?, section)
    WHERE id = ? AND review_id = ?
  `).run(field_label, field_type, options ? JSON.stringify(options) : null, required !== undefined ? (required ? 1 : 0) : null,
    order_num, section, req.params.fieldId, req.params.reviewId);

  const field = db.prepare('SELECT * FROM extraction_fields WHERE id = ?').get(req.params.fieldId) as any;
  if (field) field.options = JSON.parse(field.options);
  res.json(field);
});

router.delete('/:reviewId/extraction/fields/:fieldId', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || !['owner', 'admin'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  db.prepare('DELETE FROM extraction_fields WHERE id = ? AND review_id = ?').run(req.params.fieldId, req.params.reviewId);
  res.json({ success: true });
});

router.put('/:reviewId/extraction/fields/reorder', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || !['owner', 'admin'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { order } = req.body; // array of { id, order_num }
  const update = db.transaction(() => {
    for (const item of order) {
      db.prepare('UPDATE extraction_fields SET order_num = ? WHERE id = ? AND review_id = ?').run(item.order_num, item.id, req.params.reviewId);
    }
  });
  update();
  res.json({ success: true });
});

// Data extraction
router.get('/:reviewId/extraction/:articleId', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access) return res.status(403).json({ error: 'Access denied' });

  const review = db.prepare('SELECT blinding_enabled FROM reviews WHERE id = ?').get(req.params.reviewId) as any;
  const blinded = review?.blinding_enabled === 1;
  const uid = req.user!.id;

  let query = `
    SELECT ed.*, u.name, u.avatar_color, ef.field_label, ef.field_type, ef.section
    FROM extraction_data ed
    JOIN users u ON ed.user_id = u.id
    JOIN extraction_fields ef ON ed.field_id = ef.id
    WHERE ed.article_id = ? AND ed.review_id = ?
  `;
  const params: any[] = [req.params.articleId, req.params.reviewId];

  if (blinded) { query += ' AND ed.user_id = ?'; params.push(uid); }

  const data = db.prepare(query).all(...params);
  res.json(data);
});

router.post('/:reviewId/extraction/:articleId', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || ['viewer', 'highlighter'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { field_id, value } = req.body;
  if (!field_id) return res.status(400).json({ error: 'field_id required' });

  const article = db.prepare('SELECT id FROM articles WHERE id = ? AND review_id = ?').get(req.params.articleId, req.params.reviewId);
  if (!article) return res.status(404).json({ error: 'Article not found' });

  const field = db.prepare('SELECT id FROM extraction_fields WHERE id = ? AND review_id = ?').get(field_id, req.params.reviewId);
  if (!field) return res.status(404).json({ error: 'Field not found' });

  const existing = db.prepare('SELECT id FROM extraction_data WHERE article_id = ? AND field_id = ? AND user_id = ?')
    .get(req.params.articleId, field_id, req.user!.id);

  if (existing) {
    db.prepare(`UPDATE extraction_data SET value = ?, updated_at = datetime('now') WHERE id = ?`).run(value || '', (existing as any).id);
  } else {
    db.prepare('INSERT INTO extraction_data (id, article_id, review_id, user_id, field_id, value) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), req.params.articleId, req.params.reviewId, req.user!.id, field_id, value || '');
    awardPoints(req.user!.id, POINTS.EXTRACT_DATA, req.params.reviewId);
    updateStreak(req.user!.id);
  }

  res.json({ success: true });
});

router.post('/:reviewId/extraction/:articleId/bulk', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || ['viewer', 'highlighter'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { fields } = req.body; // array of { field_id, value }
  if (!Array.isArray(fields)) return res.status(400).json({ error: 'fields array required' });

  let newFields = 0;
  transaction(() => {
    for (const { field_id, value } of fields) {
      const existing = db.prepare('SELECT id FROM extraction_data WHERE article_id = ? AND field_id = ? AND user_id = ?')
        .get(req.params.articleId, field_id, req.user!.id);
      if (existing) {
        db.prepare(`UPDATE extraction_data SET value = ?, updated_at = datetime('now') WHERE id = ?`).run(value || '', (existing as any).id);
      } else {
        db.prepare('INSERT INTO extraction_data (id, article_id, review_id, user_id, field_id, value) VALUES (?, ?, ?, ?, ?, ?)')
          .run(uuidv4(), req.params.articleId, req.params.reviewId, req.user!.id, field_id, value || '');
        newFields++;
      }
    }
  });

  if (newFields > 0) {
    awardPoints(req.user!.id, POINTS.EXTRACT_DATA, req.params.reviewId);
    updateStreak(req.user!.id);
  }

  res.json({ success: true, updated: fields.length });
});

// Summary/export
router.get('/:reviewId/extraction/summary', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access) return res.status(403).json({ error: 'Access denied' });

  const fields = db.prepare('SELECT * FROM extraction_fields WHERE review_id = ? ORDER BY order_num').all(req.params.reviewId) as any[];

  const includedArticles = db.prepare(`
    SELECT DISTINCT a.id, a.title, a.authors, a.year, a.journal, a.doi
    FROM articles a
    JOIN screening_decisions sd ON sd.article_id = a.id
    WHERE sd.review_id = ? AND sd.phase = 'fulltext' AND sd.decision = 'include' AND a.is_duplicate_primary = 1
  `).all(req.params.reviewId) as any[];

  const result = [];
  for (const article of includedArticles) {
    const extracted: Record<string, any> = {};
    for (const field of fields) {
      const data = db.prepare('SELECT value, user_id FROM extraction_data WHERE article_id = ? AND field_id = ?')
        .all(article.id, field.id) as any[];
      extracted[field.field_name] = data.length === 1 ? data[0].value : data.map(d => d.value);
    }
    result.push({ ...article, extracted });
  }

  res.json({ fields, articles: result });
});

export default router;
