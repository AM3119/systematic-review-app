import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { awardPoints, updateStreak, POINTS, createNotification } from '../utils/gamification';

const router = Router();

function reviewAccess(reviewId: string, userId: string) {
  return db.prepare('SELECT role FROM review_members WHERE review_id = ? AND user_id = ?').get(reviewId, userId) as { role: string } | undefined;
}

function checkConflicts(articleId: string, reviewId: string, phase: string) {
  const decisions = db.prepare(`
    SELECT sd.decision, sd.user_id FROM screening_decisions sd
    JOIN review_members rm ON rm.user_id = sd.user_id AND rm.review_id = ?
    WHERE sd.article_id = ? AND sd.phase = ? AND rm.role IN ('owner', 'admin', 'reviewer')
  `).all(reviewId, articleId, phase) as any[];

  if (decisions.length < 2) return false;
  const uniqueDecisions = new Set(decisions.map((d: any) => d.decision));
  return uniqueDecisions.size > 1;
}

router.post('/:reviewId/screen', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || ['viewer'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { article_id, phase, decision, reason, notes, time_spent } = req.body;
  if (!article_id || !phase || !decision) return res.status(400).json({ error: 'article_id, phase, and decision required' });
  if (!['abstract', 'fulltext'].includes(phase)) return res.status(400).json({ error: 'Phase must be abstract or fulltext' });
  if (!['include', 'exclude', 'maybe'].includes(decision)) return res.status(400).json({ error: 'Decision must be include, exclude, or maybe' });

  const article = db.prepare('SELECT id FROM articles WHERE id = ? AND review_id = ?').get(article_id, req.params.reviewId);
  if (!article) return res.status(404).json({ error: 'Article not found in this review' });

  const existing = db.prepare('SELECT id FROM screening_decisions WHERE article_id = ? AND user_id = ? AND phase = ?')
    .get(article_id, req.user!.id, phase);

  const id = existing ? (existing as any).id : uuidv4();

  if (existing) {
    db.prepare(`
      UPDATE screening_decisions SET decision = ?, reason = ?, notes = ?, time_spent = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(decision, reason || '', notes || '', time_spent || 0, id);
  } else {
    db.prepare(`
      INSERT INTO screening_decisions (id, article_id, review_id, user_id, phase, decision, reason, notes, time_spent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, article_id, req.params.reviewId, req.user!.id, phase, decision, reason || '', notes || '', time_spent || 0);

    const pts = phase === 'abstract' ? POINTS.SCREEN_ABSTRACT : POINTS.SCREEN_FULLTEXT;
    awardPoints(req.user!.id, pts, req.params.reviewId);
    updateStreak(req.user!.id);
  }

  // Check for conflicts
  const hasConflict = checkConflicts(article_id, req.params.reviewId, phase);
  if (hasConflict) {
    const existingConflict = db.prepare('SELECT id FROM conflicts WHERE article_id = ? AND review_id = ? AND phase = ? AND resolved = 0')
      .get(article_id, req.params.reviewId, phase);
    if (!existingConflict) {
      db.prepare('INSERT INTO conflicts (id, article_id, review_id, phase) VALUES (?, ?, ?, ?)')
        .run(uuidv4(), article_id, req.params.reviewId, phase);
    }
    // Notify review owner/admins
    const admins = db.prepare(`
      SELECT user_id FROM review_members WHERE review_id = ? AND role IN ('owner', 'admin') AND user_id != ?
    `).all(req.params.reviewId, req.user!.id) as any[];
    for (const admin of admins) {
      createNotification(admin.user_id, 'conflict', `Screening conflict detected in phase: ${phase}`, req.params.reviewId);
    }
  }

  res.json({ id, decision, has_conflict: hasConflict });
});

router.get('/:reviewId/screen/progress', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access) return res.status(403).json({ error: 'Access denied' });

  const uid = req.user!.id;
  const rid = req.params.reviewId;

  const totalArticles = (db.prepare('SELECT COUNT(*) as c FROM articles WHERE review_id = ? AND is_duplicate_primary = 1').get(rid) as any)?.c || 0;

  const myAbstract = (db.prepare(`SELECT COUNT(*) as c FROM screening_decisions WHERE review_id = ? AND user_id = ? AND phase = 'abstract'`).get(rid, uid) as any)?.c || 0;
  const myFulltext = (db.prepare(`SELECT COUNT(*) as c FROM screening_decisions WHERE review_id = ? AND user_id = ? AND phase = 'fulltext'`).get(rid, uid) as any)?.c || 0;

  // For my next unscreened article
  const nextAbstract = db.prepare(`
    SELECT a.id FROM articles a
    WHERE a.review_id = ? AND a.is_duplicate_primary = 1
    AND NOT EXISTS (SELECT 1 FROM screening_decisions sd WHERE sd.article_id = a.id AND sd.user_id = ? AND sd.phase = 'abstract')
    LIMIT 1
  `).get(rid, uid) as any;

  const nextFulltext = db.prepare(`
    SELECT a.id FROM articles a
    WHERE a.review_id = ? AND a.is_duplicate_primary = 1
    AND EXISTS (SELECT 1 FROM screening_decisions sd WHERE sd.article_id = a.id AND sd.user_id = ? AND sd.phase = 'abstract' AND sd.decision = 'include')
    AND NOT EXISTS (SELECT 1 FROM screening_decisions sd WHERE sd.article_id = a.id AND sd.user_id = ? AND sd.phase = 'fulltext')
    LIMIT 1
  `).get(rid, uid, uid) as any;

  const conflicts = (db.prepare('SELECT COUNT(*) as c FROM conflicts WHERE review_id = ? AND resolved = 0').get(rid) as any)?.c || 0;

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

router.get('/:reviewId/conflicts', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access) return res.status(403).json({ error: 'Access denied' });

  const conflicts = db.prepare(`
    SELECT c.*, a.title, a.authors, a.abstract, a.journal, a.year,
      json_group_array(json_object('user_id', sd.user_id, 'name', u.name, 'decision', sd.decision, 'reason', sd.reason, 'avatar_color', u.avatar_color)) as decisions
    FROM conflicts c
    JOIN articles a ON c.article_id = a.id
    JOIN screening_decisions sd ON sd.article_id = c.article_id AND sd.phase = c.phase
    JOIN users u ON sd.user_id = u.id
    WHERE c.review_id = ? AND c.resolved = 0
    GROUP BY c.id
  `).all(req.params.reviewId) as any[];

  for (const c of conflicts) c.decisions = JSON.parse(c.decisions);
  res.json(conflicts);
});

router.post('/:reviewId/conflicts/:conflictId/resolve', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || !['owner', 'admin'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { resolution, final_decision, reason } = req.body;
  const conflict = db.prepare('SELECT * FROM conflicts WHERE id = ? AND review_id = ?').get(req.params.conflictId, req.params.reviewId) as any;
  if (!conflict) return res.status(404).json({ error: 'Conflict not found' });

  db.prepare(`UPDATE conflicts SET resolved = 1, resolution = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`)
    .run(resolution || '', req.user!.id, req.params.conflictId);

  if (final_decision) {
    const existing = db.prepare('SELECT id FROM screening_decisions WHERE article_id = ? AND user_id = ? AND phase = ?')
      .get(conflict.article_id, req.user!.id, conflict.phase);

    if (existing) {
      db.prepare(`UPDATE screening_decisions SET decision = ?, reason = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(final_decision, reason || 'Resolved conflict', (existing as any).id);
    } else {
      db.prepare('INSERT INTO screening_decisions (id, article_id, review_id, user_id, phase, decision, reason) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uuidv4(), conflict.article_id, req.params.reviewId, req.user!.id, conflict.phase, final_decision, reason || 'Resolved conflict');
    }
    awardPoints(req.user!.id, POINTS.RESOLVE_CONFLICT, req.params.reviewId);
  }

  res.json({ success: true });
});

router.get('/:reviewId/decisions', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access) return res.status(403).json({ error: 'Access denied' });

  const review = db.prepare('SELECT blinding_enabled FROM reviews WHERE id = ?').get(req.params.reviewId) as any;
  const blinded = review?.blinding_enabled === 1;
  const uid = req.user!.id;

  let query = `
    SELECT sd.*, u.name, u.avatar_color, a.title, a.authors, a.year, a.journal
    FROM screening_decisions sd
    JOIN users u ON sd.user_id = u.id
    JOIN articles a ON sd.article_id = a.id
    WHERE sd.review_id = ?
  `;

  const params: any[] = [req.params.reviewId];
  if (blinded) {
    query += ' AND sd.user_id = ?';
    params.push(uid);
  }

  if (req.query.phase) { query += ' AND sd.phase = ?'; params.push(req.query.phase); }

  query += ' ORDER BY sd.updated_at DESC LIMIT 100';

  res.json(db.prepare(query).all(...params));
});

export default router;
