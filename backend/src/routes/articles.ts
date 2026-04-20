import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import db, { transaction } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { parseRIS, parseBibTeX, parseCSV } from '../utils/parser';
import { detectDuplicates, groupDuplicates } from '../utils/duplicates';
import { fetchFullText } from '../utils/fulltext';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// PDF upload storage
const PDF_DIR = path.join(__dirname, '../../../data/pdfs');
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });
const pdfStorage = multer.diskStorage({
  destination: PDF_DIR,
  filename: (_req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`)
});
const pdfUpload = multer({ storage: pdfStorage, limits: { fileSize: 50 * 1024 * 1024 } });

function reviewAccess(reviewId: string, userId: string) {
  return db.prepare('SELECT role FROM review_members WHERE review_id = ? AND user_id = ?').get(reviewId, userId) as { role: string } | undefined;
}

// ─── Article listing ────────────────────────────────────────────────────────
router.get('/:reviewId/articles', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access) return res.status(403).json({ error: 'Access denied' });

  const { phase = 'abstract', decision, search, tag, duplicate, require_abstract, limit = 50, offset = 0 } = req.query;
  const uid = req.user!.id;
  const rid = req.params.reviewId;

  // Build WHERE conditions separately so count & data share the same params
  const conditions: string[] = ['a.review_id = ?'];
  const whereParams: any[] = [rid];

  if (duplicate === 'only') {
    conditions.push('a.is_duplicate_primary = 0');
  } else if (duplicate !== 'include') {
    conditions.push('a.is_duplicate_primary = 1');
  }

  if (decision === 'unscreened') {
    conditions.push('NOT EXISTS (SELECT 1 FROM screening_decisions sd WHERE sd.article_id = a.id AND sd.user_id = ? AND sd.phase = ?)');
    whereParams.push(uid, phase);
  } else if (decision && decision !== 'all') {
    conditions.push('EXISTS (SELECT 1 FROM screening_decisions sd WHERE sd.article_id = a.id AND sd.user_id = ? AND sd.phase = ? AND sd.decision = ?)');
    whereParams.push(uid, phase, decision);
  }

  if (tag) {
    conditions.push('EXISTS (SELECT 1 FROM article_tags at WHERE at.article_id = a.id AND at.tag_id = ?)');
    whereParams.push(tag);
  }

  // require_abstract: filter to articles where user's abstract decision is in this comma-list
  if (require_abstract) {
    const decisions = (require_abstract as string).split(',').map(d => d.trim()).filter(Boolean);
    const ph = decisions.map(() => '?').join(',');
    conditions.push(`EXISTS (SELECT 1 FROM screening_decisions sd WHERE sd.article_id = a.id AND sd.user_id = ? AND sd.phase = 'abstract' AND sd.decision IN (${ph}))`);
    whereParams.push(uid, ...decisions);
  }

  if (search) {
    conditions.push('(a.title LIKE ? OR a.abstract LIKE ? OR a.authors LIKE ? OR a.journal LIKE ?)');
    const s = `%${search}%`;
    whereParams.push(s, s, s, s);
  }

  const WHERE = conditions.join(' AND ');

  // Count (same params)
  const total = (db.prepare(`SELECT COUNT(*) as count FROM articles a WHERE ${WHERE}`).get(...whereParams) as any)?.count || 0;

  // Determine if blinded
  const review = db.prepare('SELECT blinding_enabled FROM reviews WHERE id = ?').get(rid) as any;
  const blinded = review?.blinding_enabled === 1;

  // Data query - join my decision only
  const dataParams = [uid, phase as string, ...whereParams];
  const articles = db.prepare(`
    SELECT a.*,
      my_sd.decision as my_decision,
      my_sd.reason as my_reason,
      my_sd.notes as my_notes,
      my_sd.time_spent as my_time_spent
    FROM articles a
    LEFT JOIN screening_decisions my_sd
      ON my_sd.article_id = a.id AND my_sd.user_id = ? AND my_sd.phase = ?
    WHERE ${WHERE}
    ORDER BY a.created_at ASC
    LIMIT ? OFFSET ?
  `).all(...dataParams, Number(limit), Number(offset));

  // Attach others_decisions if not blinded (separate query per article to avoid param complexity)
  if (!blinded && articles.length > 0) {
    const articleIds = (articles as any[]).map((a: any) => a.id);
    const placeholders = articleIds.map(() => '?').join(',');
    const others = db.prepare(`
      SELECT sd.article_id, sd.decision, sd.reason, u.name, u.avatar_color
      FROM screening_decisions sd
      JOIN users u ON sd.user_id = u.id
      WHERE sd.article_id IN (${placeholders}) AND sd.phase = ? AND sd.user_id != ?
    `).all(...articleIds, phase as string, uid) as any[];

    const othersMap: Record<string, any[]> = {};
    for (const d of others) {
      if (!othersMap[d.article_id]) othersMap[d.article_id] = [];
      othersMap[d.article_id].push({ name: d.name, avatar_color: d.avatar_color, decision: d.decision, reason: d.reason });
    }
    for (const a of articles as any[]) {
      a.others_decisions = othersMap[a.id] || [];
    }
  }

  res.json({ articles, total, offset: Number(offset), limit: Number(limit) });
});

// ─── Single article ──────────────────────────────────────────────────────────
router.get('/:reviewId/articles/:articleId', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access) return res.status(403).json({ error: 'Access denied' });

  const article = db.prepare('SELECT * FROM articles WHERE id = ? AND review_id = ?')
    .get(req.params.articleId, req.params.reviewId);
  if (!article) return res.status(404).json({ error: 'Article not found' });

  const review = db.prepare('SELECT blinding_enabled FROM reviews WHERE id = ?').get(req.params.reviewId) as any;
  const blinded = review?.blinding_enabled === 1;

  const decisions: any = {};
  const allDecisions = blinded
    ? db.prepare('SELECT * FROM screening_decisions WHERE article_id = ? AND user_id = ?').all(req.params.articleId, req.user!.id) as any[]
    : db.prepare(`SELECT sd.*, u.name, u.avatar_color FROM screening_decisions sd JOIN users u ON sd.user_id = u.id WHERE sd.article_id = ?`).all(req.params.articleId) as any[];

  for (const d of allDecisions) {
    if (!decisions[d.phase]) decisions[d.phase] = [];
    decisions[d.phase].push(d);
  }

  const tags = db.prepare(`SELECT t.* FROM article_tags at JOIN tags t ON at.tag_id = t.id WHERE at.article_id = ?`).all(req.params.articleId);

  res.json({ ...(article as object), decisions, tags });
});

// ─── Create article ──────────────────────────────────────────────────────────
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

// ─── Import ──────────────────────────────────────────────────────────────────
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

// ─── Duplicate detection ─────────────────────────────────────────────────────
router.post('/:reviewId/articles/detect-duplicates', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || !['owner', 'admin'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const { threshold = 0.85 } = req.body;
  const articles = db.prepare('SELECT id, title, authors, year, doi, pmid, journal, abstract FROM articles WHERE review_id = ?')
    .all(req.params.reviewId) as any[];

  const pairs = detectDuplicates(articles, Number(threshold));
  const groups = groupDuplicates(pairs);

  db.prepare('UPDATE articles SET duplicate_group_id = NULL, is_duplicate_primary = 1 WHERE review_id = ?').run(req.params.reviewId);

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

// ─── Full-text fetch ─────────────────────────────────────────────────────────
router.post('/:reviewId/articles/:articleId/fetch-fulltext', authMiddleware, async (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || ['viewer'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const article = db.prepare('SELECT * FROM articles WHERE id = ? AND review_id = ?')
    .get(req.params.articleId, req.params.reviewId) as any;
  if (!article) return res.status(404).json({ error: 'Article not found' });

  try {
    const result = await fetchFullText(article, PDF_DIR);
    if (result.found) {
      db.prepare('UPDATE articles SET full_text_url = ? WHERE id = ?').run(result.url as string, req.params.articleId as string);
      res.json({ found: true, url: result.url, source: result.source });
    } else {
      res.json({ found: false, message: result.message });
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Fetch failed', message: err.message });
  }
});

// ─── PDF upload ───────────────────────────────────────────────────────────────
router.post('/:reviewId/articles/:articleId/upload-pdf', authMiddleware, pdfUpload.single('pdf'), (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || ['viewer'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  if (!req.file) return res.status(400).json({ error: 'No file' });

  const url = `/api/pdfs/${req.file.filename}`;
  db.prepare('UPDATE articles SET full_text_url = ? WHERE id = ? AND review_id = ?').run(url, req.params.articleId, req.params.reviewId);
  res.json({ url });
});

// ─── Update article ───────────────────────────────────────────────────────────
router.put('/:reviewId/articles/:articleId', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || ['viewer', 'highlighter'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const fields = ['full_text_url', 'notes', 'title', 'abstract', 'authors', 'journal', 'year', 'doi', 'pmid'];
  const updates = fields.filter(f => req.body[f] !== undefined).map(f => `${f} = ?`);
  const vals = fields.filter(f => req.body[f] !== undefined).map(f => req.body[f]);
  if (!updates.length) return res.json({ success: true });

  db.prepare(`UPDATE articles SET ${updates.join(', ')} WHERE id = ? AND review_id = ?`).run(...vals, req.params.articleId, req.params.reviewId);
  res.json({ success: true });
});

router.delete('/:reviewId/articles/:articleId', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || !['owner', 'admin'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  db.prepare('DELETE FROM articles WHERE id = ? AND review_id = ?').run(req.params.articleId, req.params.reviewId);
  res.json({ success: true });
});

// ─── Tags ─────────────────────────────────────────────────────────────────────
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
  db.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)').run(req.params.articleId, req.body.tag_id);
  res.json({ success: true });
});

router.delete('/:reviewId/articles/:articleId/tags/:tagId', authMiddleware, (req: AuthRequest, res: Response) => {
  db.prepare('DELETE FROM article_tags WHERE article_id = ? AND tag_id = ?').run(req.params.articleId, req.params.tagId);
  res.json({ success: true });
});

// ─── Duplicate groups ─────────────────────────────────────────────────────────
router.get('/:reviewId/duplicate-groups', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access) return res.status(403).json({ error: 'Access denied' });

  const rows = db.prepare(`
    SELECT duplicate_group_id,
      json_group_array(json_object(
        'id', id, 'title', title, 'authors', authors, 'year', year,
        'journal', journal, 'doi', doi, 'pmid', pmid,
        'abstract', abstract,
        'is_duplicate_primary', is_duplicate_primary
      )) as articles,
      COUNT(*) as count
    FROM articles
    WHERE review_id = ? AND duplicate_group_id IS NOT NULL
    GROUP BY duplicate_group_id
    HAVING COUNT(*) > 1
  `).all(req.params.reviewId) as any[];

  // Attach pair similarity scores
  const result = rows.map(g => {
    const articles = JSON.parse(g.articles);
    return { duplicate_group_id: g.duplicate_group_id, articles };
  });

  res.json(result);
});

export default router;
