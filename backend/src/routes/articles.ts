import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import db, { transaction } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { parseRIS, parseBibTeX, parseCSV } from '../utils/parser';
import { detectDuplicates, groupDuplicates } from '../utils/duplicates';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function reviewAccess(reviewId: string, userId: string) {
  return db.prepare('SELECT role FROM review_members WHERE review_id = ? AND user_id = ?').get(reviewId, userId) as { role: string } | undefined;
}

router.get('/:reviewId/articles', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access) return res.status(403).json({ error: 'Access denied' });

  const { phase, decision, search, tag, duplicate, limit = 50, offset = 0 } = req.query;
  const uid = req.user!.id;
  const rid = req.params.reviewId;

  const review = db.prepare('SELECT blinding_enabled FROM reviews WHERE id = ?').get(rid) as any;
  const blinded = review?.blinding_enabled === 1;

  let query = `
    SELECT a.*,
      (SELECT json_group_array(json_object('id', t.id, 'name', t.name, 'color', t.color))
       FROM article_tags at JOIN tags t ON at.tag_id = t.id WHERE at.article_id = a.id) as tags,
      my_sd.decision as my_decision, my_sd.reason as my_reason, my_sd.notes as my_notes,
      my_sd.time_spent as my_time_spent,
      ${blinded ? 'NULL' : `(SELECT json_group_array(json_object('user_id', sd2.user_id, 'name', u2.name, 'decision', sd2.decision, 'reason', sd2.reason))
        FROM screening_decisions sd2 JOIN users u2 ON sd2.user_id = u2.id
        WHERE sd2.article_id = a.id AND sd2.phase = COALESCE(?, 'abstract') AND sd2.user_id != ?)`} as others_decisions
    FROM articles a
    LEFT JOIN screening_decisions my_sd ON my_sd.article_id = a.id AND my_sd.user_id = ? AND my_sd.phase = COALESCE(?, 'abstract')
    WHERE a.review_id = ?
  `;

  const params: any[] = blinded
    ? [uid, phase || 'abstract', rid]
    : [phase || 'abstract', uid, uid, phase || 'abstract', rid];

  if (duplicate === 'only') {
    query += ' AND a.is_duplicate_primary = 0';
  } else if (duplicate !== 'include') {
    query += ' AND a.is_duplicate_primary = 1';
  }

  if (decision === 'unscreened') {
    query += ' AND my_sd.id IS NULL';
  } else if (decision && decision !== 'all') {
    query += ` AND my_sd.decision = ?`;
    params.push(decision);
  }

  if (tag) {
    query += ' AND EXISTS (SELECT 1 FROM article_tags at WHERE at.article_id = a.id AND at.tag_id = ?)';
    params.push(tag);
  }

  if (search) {
    query += ' AND (a.title LIKE ? OR a.abstract LIKE ? OR a.authors LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const countQuery = query.replace(/SELECT a\.\*[\s\S]*?FROM articles a/, 'SELECT COUNT(*) as count FROM articles a');
  const total = (db.prepare(countQuery).get(...params) as any)?.count || 0;

  query += ` ORDER BY a.created_at ASC LIMIT ? OFFSET ?`;
  params.push(Number(limit), Number(offset));

  const articles = db.prepare(query).all(...params);
  res.json({ articles, total, offset: Number(offset), limit: Number(limit) });
});

router.post('/:reviewId/articles', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || ['viewer', 'highlighter'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { title, authors, abstract, journal, year, doi, pmid, url, source_db, keywords, volume, issue, pages } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO articles (id, review_id, title, authors, abstract, journal, year, doi, pmid, url, source_db, keywords, volume, issue, pages)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.reviewId, title, authors || '', abstract || '', journal || '', year || null,
    doi || '', pmid || '', url || '', source_db || '', keywords || '', volume || '', issue || '', pages || '');

  res.json(db.prepare('SELECT * FROM articles WHERE id = ?').get(id));
});

router.post('/:reviewId/articles/import', authMiddleware, upload.single('file'), async (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || ['viewer', 'highlighter'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const content = req.file.buffer.toString('utf-8');
  const filename = req.file.originalname.toLowerCase();
  const batchId = uuidv4();

  let parsed: any[] = [];
  if (filename.endsWith('.ris')) parsed = parseRIS(content);
  else if (filename.endsWith('.bib')) parsed = parseBibTeX(content);
  else if (filename.endsWith('.csv')) parsed = parseCSV(content);
  else return res.status(400).json({ error: 'Unsupported format. Use .ris, .bib, or .csv' });

  const insert = db.prepare(`
    INSERT INTO articles (id, review_id, title, authors, abstract, journal, year, doi, pmid, url, source_db, keywords, volume, issue, pages, import_batch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  transaction(() => {
    for (const a of parsed) {
      insert.run(uuidv4(), req.params.reviewId, a.title, a.authors || '', a.abstract || '', a.journal || '',
        a.year || null, a.doi || '', a.pmid || '', a.url || '', a.source_db || '', a.keywords || '',
        a.volume || '', a.issue || '', a.pages || '', batchId);
    }
  });
  res.json({ imported: parsed.length, batch_id: batchId });
});

router.post('/:reviewId/articles/detect-duplicates', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || !['owner', 'admin'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const articles = db.prepare('SELECT id, title, authors, year, doi, pmid, journal FROM articles WHERE review_id = ?')
    .all(req.params.reviewId) as any[];

  const pairs = detectDuplicates(articles);
  const groups = groupDuplicates(pairs);

  // Reset existing duplicate assignments
  db.prepare('UPDATE articles SET duplicate_group_id = NULL, is_duplicate_primary = 1 WHERE review_id = ?')
    .run(req.params.reviewId);

  let totalDuplicates = 0;
  transaction(() => {
    for (const [groupId, memberIds] of groups) {
      for (let i = 0; i < memberIds.length; i++) {
        const isPrimary = i === 0 ? 1 : 0;
        db.prepare('UPDATE articles SET duplicate_group_id = ?, is_duplicate_primary = ? WHERE id = ?')
          .run(groupId, isPrimary, memberIds[i]);
        if (!isPrimary) totalDuplicates++;
      }
    }
  });

  res.json({ groups: groups.size, duplicates_found: totalDuplicates, pairs: pairs.length });
});

router.put('/:reviewId/articles/:articleId/duplicate', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || !['owner', 'admin', 'reviewer'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { is_duplicate_primary, duplicate_group_id } = req.body;
  db.prepare('UPDATE articles SET is_duplicate_primary = ?, duplicate_group_id = ? WHERE id = ? AND review_id = ?')
    .run(is_duplicate_primary ? 1 : 0, duplicate_group_id || null, req.params.articleId, req.params.reviewId);

  res.json({ success: true });
});

router.get('/:reviewId/articles/:articleId', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access) return res.status(403).json({ error: 'Access denied' });

  const article = db.prepare('SELECT * FROM articles WHERE id = ? AND review_id = ?')
    .get(req.params.articleId, req.params.reviewId);
  if (!article) return res.status(404).json({ error: 'Article not found' });

  const review = db.prepare('SELECT blinding_enabled FROM reviews WHERE id = ?').get(req.params.reviewId) as any;
  const blinded = review?.blinding_enabled === 1;

  const decisions: any = {};
  if (!blinded) {
    const all = db.prepare(`
      SELECT sd.*, u.name, u.avatar_color FROM screening_decisions sd
      JOIN users u ON sd.user_id = u.id
      WHERE sd.article_id = ?
    `).all(req.params.articleId);
    for (const d of all as any[]) {
      if (!decisions[d.phase]) decisions[d.phase] = [];
      decisions[d.phase].push(d);
    }
  } else {
    const mine = db.prepare('SELECT * FROM screening_decisions WHERE article_id = ? AND user_id = ?')
      .all(req.params.articleId, req.user!.id);
    for (const d of mine as any[]) {
      if (!decisions[d.phase]) decisions[d.phase] = [];
      decisions[d.phase].push(d);
    }
  }

  const tags = db.prepare(`
    SELECT t.* FROM article_tags at JOIN tags t ON at.tag_id = t.id WHERE at.article_id = ?
  `).all(req.params.articleId);

  res.json({ ...article as object, decisions, tags });
});

router.put('/:reviewId/articles/:articleId', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || ['viewer', 'highlighter'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { full_text_url, notes } = req.body;
  db.prepare('UPDATE articles SET full_text_url = COALESCE(?, full_text_url), notes = COALESCE(?, notes) WHERE id = ? AND review_id = ?')
    .run(full_text_url, notes, req.params.articleId, req.params.reviewId);

  res.json({ success: true });
});

router.delete('/:reviewId/articles/:articleId', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || !['owner', 'admin'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  db.prepare('DELETE FROM articles WHERE id = ? AND review_id = ?').run(req.params.articleId, req.params.reviewId);
  res.json({ success: true });
});

// Tags
router.get('/:reviewId/tags', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access) return res.status(403).json({ error: 'Access denied' });
  res.json(db.prepare('SELECT * FROM tags WHERE review_id = ?').all(req.params.reviewId));
});

router.post('/:reviewId/tags', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || !['owner', 'admin'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { name, color } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO tags (id, review_id, name, color) VALUES (?, ?, ?, ?)').run(id, req.params.reviewId, name, color || '#6B7280');
  res.json(db.prepare('SELECT * FROM tags WHERE id = ?').get(id));
});

router.post('/:reviewId/articles/:articleId/tags', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || ['viewer'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { tag_id } = req.body;
  db.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)').run(req.params.articleId, tag_id);
  res.json({ success: true });
});

router.delete('/:reviewId/articles/:articleId/tags/:tagId', authMiddleware, (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM article_tags WHERE article_id = ? AND tag_id = ?').run(req.params.articleId, req.params.tagId);
  res.json({ success: true });
});

// Duplicate groups
router.get('/:reviewId/duplicate-groups', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access) return res.status(403).json({ error: 'Access denied' });

  const groups = db.prepare(`
    SELECT duplicate_group_id, json_group_array(json_object(
      'id', id, 'title', title, 'authors', authors, 'year', year, 'journal', journal,
      'doi', doi, 'pmid', pmid, 'is_duplicate_primary', is_duplicate_primary
    )) as articles
    FROM articles
    WHERE review_id = ? AND duplicate_group_id IS NOT NULL
    GROUP BY duplicate_group_id
    HAVING COUNT(*) > 1
  `).all(req.params.reviewId) as any[];

  for (const g of groups) g.articles = JSON.parse(g.articles);
  res.json(groups);
});

export default router;
