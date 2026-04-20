import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db, { transaction } from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { awardPoints, updateStreak, POINTS } from '../utils/gamification';

const router = Router();

function reviewAccess(reviewId: string, userId: string) {
  return db.prepare('SELECT role FROM review_members WHERE review_id = ? AND user_id = ?').get(reviewId, userId) as { role: string } | undefined;
}

// ─── Fields ───────────────────────────────────────────────────────────────────
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
  const { field_name, field_label, field_type, options, required, order_num, section, ai_description } = req.body;
  if (!field_name || !field_label) return res.status(400).json({ error: 'field_name and field_label required' });
  const id = uuidv4();
  db.prepare(`
    INSERT INTO extraction_fields (id, review_id, field_name, field_label, field_type, options, required, order_num, section, ai_description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.reviewId, field_name, field_label, field_type || 'text',
    JSON.stringify(options || []), required ? 1 : 0, order_num || 0, section || 'General', ai_description || '');
  const field = db.prepare('SELECT * FROM extraction_fields WHERE id = ?').get(id) as any;
  field.options = JSON.parse(field.options);
  res.json(field);
});

router.put('/:reviewId/extraction/fields/:fieldId', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || !['owner', 'admin'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  const { field_label, field_type, options, required, order_num, section, ai_description } = req.body;
  db.prepare(`
    UPDATE extraction_fields SET
      field_label = COALESCE(?, field_label),
      field_type = COALESCE(?, field_type),
      options = COALESCE(?, options),
      required = COALESCE(?, required),
      order_num = COALESCE(?, order_num),
      section = COALESCE(?, section),
      ai_description = COALESCE(?, ai_description)
    WHERE id = ? AND review_id = ?
  `).run(field_label, field_type, options ? JSON.stringify(options) : null,
    required !== undefined ? (required ? 1 : 0) : null, order_num, section, ai_description,
    req.params.fieldId, req.params.reviewId);
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

// ─── Extraction data ──────────────────────────────────────────────────────────
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
  res.json(db.prepare(query).all(...params));
});

router.post('/:reviewId/extraction/:articleId', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || ['viewer', 'highlighter'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });
  const { field_id, value } = req.body;
  if (!field_id) return res.status(400).json({ error: 'field_id required' });
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
  const { fields } = req.body;
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
  if (newFields > 0) { awardPoints(req.user!.id, POINTS.EXTRACT_DATA, req.params.reviewId); updateStreak(req.user!.id); }
  res.json({ success: true, updated: fields.length });
});

// ─── AI Extraction (Ollama - fully local) ────────────────────────────────────
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

async function ollamaChat(prompt: string): Promise<string> {
  const body = JSON.stringify({
    model: OLLAMA_MODEL,
    prompt,
    stream: false,
    options: { temperature: 0.1, num_predict: 2000 }
  });

  return new Promise((resolve, reject) => {
    const http = require('http');
    const url = new URL('/api/generate', OLLAMA_URL);
    const reqOpts = { hostname: url.hostname, port: url.port || 11434, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
    const r = http.request(reqOpts, (res: any) => {
      let data = '';
      res.on('data', (chunk: any) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data).response || ''); }
        catch { reject(new Error('Invalid Ollama response')); }
      });
    });
    r.on('error', reject);
    r.write(body);
    r.end();
  });
}

// Check if Ollama is reachable and has the model
router.get('/:reviewId/extraction/ai-status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const http = require('http');
    const url = new URL('/api/tags', OLLAMA_URL);
    const data: string = await new Promise((resolve, reject) => {
      const r = http.get({ hostname: url.hostname, port: url.port || 11434, path: url.pathname }, (resp: any) => {
        let d = ''; resp.on('data', (c: any) => d += c); resp.on('end', () => resolve(d));
      });
      r.on('error', reject);
    });
    const { models = [] } = JSON.parse(data);
    const available = models.map((m: any) => m.name);
    const modelReady = available.some((n: string) => n.startsWith(OLLAMA_MODEL));
    res.json({ ollama: true, model: OLLAMA_MODEL, model_ready: modelReady, available_models: available });
  } catch {
    res.json({ ollama: false, model: OLLAMA_MODEL, model_ready: false });
  }
});

router.post('/:reviewId/extraction/:articleId/ai-extract', authMiddleware, async (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access || ['viewer', 'highlighter'].includes(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const article = db.prepare('SELECT * FROM articles WHERE id = ? AND review_id = ?')
    .get(req.params.articleId, req.params.reviewId) as any;
  if (!article) return res.status(404).json({ error: 'Article not found' });

  const fields = db.prepare('SELECT * FROM extraction_fields WHERE review_id = ? ORDER BY order_num')
    .all(req.params.reviewId) as any[];
  for (const f of fields) f.options = JSON.parse(f.options || '[]');
  if (!fields.length) return res.status(400).json({ error: 'No extraction fields defined' });

  // Build author citation
  const authors = (article.authors || '').split(';').map((a: string) => a.trim()).filter(Boolean);
  const firstAuthorLastName = authors[0]?.split(',')[0]?.trim() || authors[0]?.split(' ').pop() || 'Unknown';
  const citation = `${firstAuthorLastName} et al. ${article.year || ''}`.trim();

  const articleContent = [
    `Title: ${article.title}`,
    `Authors: ${article.authors}`,
    `Journal: ${article.journal} (${article.year})`,
    `DOI: ${article.doi || 'N/A'}`,
    '',
    'Abstract:',
    article.abstract || '(No abstract available)',
  ].join('\n');

  const fieldsPrompt = fields.map((f: any) => {
    let desc = `  "${f.field_name}": // ${f.field_label}`;
    if (f.ai_description) desc += ` — ${f.ai_description}`;
    if (f.options?.length) desc += ` [must be one of: ${f.options.join(', ')}]`;
    return desc;
  }).join('\n');

  const prompt = `You are a systematic review data extractor. Read the article below and extract data for each field.

ARTICLE:
${articleContent}

Extract the following fields and return ONLY a JSON object (no explanation, no markdown, just raw JSON):
{
${fieldsPrompt}
}

Rules:
- For select fields, use ONLY one of the listed options exactly
- For author/citation fields use: "${citation}"
- If not reported, use "Not reported"
- Return raw JSON only, starting with { and ending with }`;

  try {
    const responseText = await ollamaChat(prompt);
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`Model returned no JSON. Response: ${responseText.slice(0, 200)}`);
    const extracted = JSON.parse(jsonMatch[0]);

    const fieldMap = new Map(fields.map((f: any) => [f.field_name, f.id]));
    const toSave: Array<{ field_id: string; value: string }> = [];
    for (const [fieldName, value] of Object.entries(extracted)) {
      const fieldId = fieldMap.get(fieldName);
      if (fieldId) toSave.push({ field_id: fieldId as string, value: String(value) });
    }

    transaction(() => {
      for (const { field_id, value } of toSave) {
        const existing = db.prepare('SELECT id FROM extraction_data WHERE article_id = ? AND field_id = ? AND user_id = ?')
          .get(req.params.articleId, field_id, req.user!.id);
        if (existing) {
          db.prepare(`UPDATE extraction_data SET value = ?, updated_at = datetime('now') WHERE id = ?`).run(value, (existing as any).id);
        } else {
          db.prepare('INSERT INTO extraction_data (id, article_id, review_id, user_id, field_id, value) VALUES (?, ?, ?, ?, ?, ?)')
            .run(uuidv4(), req.params.articleId, req.params.reviewId, req.user!.id, field_id, value);
        }
      }
    });

    awardPoints(req.user!.id, POINTS.EXTRACT_DATA * 2, req.params.reviewId);
    res.json({ success: true, extracted, citation, fields_populated: toSave.length, model: OLLAMA_MODEL });
  } catch (err: any) {
    console.error('AI extraction error:', err.message);
    if (err.message?.includes('ECONNREFUSED')) {
      return res.status(503).json({ error: 'Ollama not running', message: 'Start Ollama with: ollama serve' });
    }
    res.status(500).json({ error: 'AI extraction failed', message: err.message });
  }
});

// ─── Export summary ───────────────────────────────────────────────────────────
router.get('/:reviewId/extraction/summary', authMiddleware, (req: AuthRequest, res: Response) => {
  const access = reviewAccess(req.params.reviewId, req.user!.id);
  if (!access) return res.status(403).json({ error: 'Access denied' });
  const fields = db.prepare('SELECT * FROM extraction_fields WHERE review_id = ? ORDER BY order_num').all(req.params.reviewId) as any[];
  for (const f of fields as any[]) f.options = JSON.parse(f.options || '[]');
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
        .all(article.id, (field as any).id) as any[];
      extracted[(field as any).field_name] = data.length === 1 ? data[0].value : data.map((d: any) => d.value);
    }
    result.push({ ...article, extracted });
  }
  res.json({ fields, articles: result });
});

export default router;
