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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const db_1 = __importStar(require("../db"));
const auth_1 = require("../middleware/auth");
const gamification_1 = require("../utils/gamification");
const PDF_DIR = path_1.default.join(__dirname, '../../../data/pdfs');
async function extractPdfText(localUrl) {
    try {
        if (!localUrl.startsWith('/api/pdfs/'))
            return null;
        const filename = localUrl.replace('/api/pdfs/', '');
        const filepath = path_1.default.join(PDF_DIR, filename);
        if (!fs_1.default.existsSync(filepath))
            return null;
        const pdfParse = require('pdf-parse/lib/pdf-parse.js');
        const buf = fs_1.default.readFileSync(filepath);
        const data = await pdfParse(buf, { max: 20 }); // first 20 pages
        return data.text?.slice(0, 15000) || null; // cap at ~15k chars
    }
    catch {
        return null;
    }
}
const router = (0, express_1.Router)();
function reviewAccess(reviewId, userId) {
    return db_1.default.prepare('SELECT role FROM review_members WHERE review_id = ? AND user_id = ?').get(reviewId, userId);
}
// ─── Fields ───────────────────────────────────────────────────────────────────
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
    const { field_name, field_label, field_type, options, required, order_num, section, ai_description } = req.body;
    if (!field_name || !field_label)
        return res.status(400).json({ error: 'field_name and field_label required' });
    const id = (0, uuid_1.v4)();
    db_1.default.prepare(`
    INSERT INTO extraction_fields (id, review_id, field_name, field_label, field_type, options, required, order_num, section, ai_description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.reviewId, field_name, field_label, field_type || 'text', JSON.stringify(options || []), required ? 1 : 0, order_num || 0, section || 'General', ai_description || '');
    const field = db_1.default.prepare('SELECT * FROM extraction_fields WHERE id = ?').get(id);
    field.options = JSON.parse(field.options);
    res.json(field);
});
router.put('/:reviewId/extraction/fields/:fieldId', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access || !['owner', 'admin'].includes(access.role))
        return res.status(403).json({ error: 'Insufficient permissions' });
    const { field_label, field_type, options, required, order_num, section, ai_description } = req.body;
    db_1.default.prepare(`
    UPDATE extraction_fields SET
      field_label = COALESCE(?, field_label),
      field_type = COALESCE(?, field_type),
      options = COALESCE(?, options),
      required = COALESCE(?, required),
      order_num = COALESCE(?, order_num),
      section = COALESCE(?, section),
      ai_description = COALESCE(?, ai_description)
    WHERE id = ? AND review_id = ?
  `).run(field_label, field_type, options ? JSON.stringify(options) : null, required !== undefined ? (required ? 1 : 0) : null, order_num, section, ai_description, req.params.fieldId, req.params.reviewId);
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
// ─── Static GET routes MUST be before /:articleId wildcard ───────────────────
// Check if Ollama is reachable and has the model
router.get('/:reviewId/extraction/ai-status', auth_1.authMiddleware, async (req, res) => {
    try {
        const http = require('http');
        const url = new URL('/api/tags', OLLAMA_URL);
        const data = await new Promise((resolve, reject) => {
            const r = http.get({ hostname: url.hostname, port: url.port || 11434, path: url.pathname }, (resp) => {
                let d = '';
                resp.on('data', (c) => d += c);
                resp.on('end', () => resolve(d));
            });
            r.on('error', reject);
        });
        const { models = [] } = JSON.parse(data);
        const available = models.map((m) => m.name);
        const modelReady = available.some((n) => n.startsWith(OLLAMA_MODEL));
        res.json({ ollama: true, model: OLLAMA_MODEL, model_ready: modelReady, available_models: available });
    }
    catch {
        res.json({ ollama: false, model: OLLAMA_MODEL, model_ready: false });
    }
});
// Export summary (spreadsheet data)
router.get('/:reviewId/extraction/summary', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access)
        return res.status(403).json({ error: 'Access denied' });
    const uid = req.user.id;
    const fields = db_1.default.prepare('SELECT * FROM extraction_fields WHERE review_id = ? ORDER BY order_num').all(req.params.reviewId);
    for (const f of fields)
        f.options = JSON.parse(f.options || '[]');
    const includedArticles = db_1.default.prepare(`
    SELECT DISTINCT a.id, a.title, a.authors, a.year, a.journal, a.doi, a.full_text_url
    FROM articles a
    WHERE a.review_id = ? AND a.is_duplicate_primary = 1
    AND a.full_text_url IS NOT NULL AND a.full_text_url != ''
    AND EXISTS (
      SELECT 1 FROM screening_decisions sd
      WHERE sd.article_id = a.id AND sd.user_id = ? AND sd.decision = 'include'
    )
    ORDER BY a.created_at ASC
  `).all(req.params.reviewId, uid);
    const result = [];
    for (const article of includedArticles) {
        const authors = (article.authors || '').split(';').map((a) => a.trim()).filter(Boolean);
        const lastName = authors[0]?.split(',')[0]?.trim() || authors[0]?.split(' ').pop() || 'Unknown';
        const citation = authors.length > 1 ? `${lastName} et al. ${article.year || ''}` : `${lastName} ${article.year || ''}`;
        const extracted = {};
        for (const field of fields) {
            const data = db_1.default.prepare('SELECT value FROM extraction_data WHERE article_id = ? AND field_id = ? AND user_id = ?')
                .get(article.id, field.id, uid);
            extracted[field.id] = data?.value || '';
        }
        result.push({ ...article, citation, extracted });
    }
    res.json({ fields, articles: result });
});
// ─── Extraction data (wildcard :articleId — keep AFTER all static GET routes) ─
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
    res.json(db_1.default.prepare(query).all(...params));
});
router.post('/:reviewId/extraction/:articleId', auth_1.authMiddleware, (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access || ['viewer', 'highlighter'].includes(access.role))
        return res.status(403).json({ error: 'Insufficient permissions' });
    const { field_id, value } = req.body;
    if (!field_id)
        return res.status(400).json({ error: 'field_id required' });
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
    const { fields } = req.body;
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
// ─── AI Extraction (Ollama - fully local) ────────────────────────────────────
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
async function ollamaChat(prompt) {
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
        const r = http.request(reqOpts, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data).response || '');
                }
                catch {
                    reject(new Error('Invalid Ollama response'));
                }
            });
        });
        r.on('error', reject);
        r.write(body);
        r.end();
    });
}
router.post('/:reviewId/extraction/:articleId/ai-extract', auth_1.authMiddleware, async (req, res) => {
    const access = reviewAccess(req.params.reviewId, req.user.id);
    if (!access || ['viewer', 'highlighter'].includes(access.role))
        return res.status(403).json({ error: 'Insufficient permissions' });
    const article = db_1.default.prepare('SELECT * FROM articles WHERE id = ? AND review_id = ?')
        .get(req.params.articleId, req.params.reviewId);
    if (!article)
        return res.status(404).json({ error: 'Article not found' });
    const fields = db_1.default.prepare('SELECT * FROM extraction_fields WHERE review_id = ? ORDER BY order_num')
        .all(req.params.reviewId);
    for (const f of fields)
        f.options = JSON.parse(f.options || '[]');
    if (!fields.length)
        return res.status(400).json({ error: 'No extraction fields defined' });
    // Build author citation
    const authors = (article.authors || '').split(';').map((a) => a.trim()).filter(Boolean);
    const firstAuthorLastName = authors[0]?.split(',')[0]?.trim() || authors[0]?.split(' ').pop() || 'Unknown';
    const citation = `${firstAuthorLastName} et al. ${article.year || ''}`.trim();
    // Try to read full-text PDF first, fall back to abstract
    const pdfText = article.full_text_url ? await extractPdfText(article.full_text_url) : null;
    const contentSource = pdfText ? 'FULL TEXT (from PDF)' : 'ABSTRACT ONLY';
    const articleContent = [
        `Title: ${article.title}`,
        `Authors: ${article.authors}`,
        `Journal: ${article.journal} (${article.year})`,
        `DOI: ${article.doi || 'N/A'}`,
        '',
        pdfText ? `Full Text:\n${pdfText}` : `Abstract:\n${article.abstract || '(No abstract available)'}`,
    ].join('\n');
    const fieldsPrompt = fields.map((f) => {
        let desc = `  "${f.field_name}": // ${f.field_label}`;
        if (f.ai_description)
            desc += ` — ${f.ai_description}`;
        if (f.options?.length)
            desc += ` [must be one of: ${f.options.join(', ')}]`;
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
        if (!jsonMatch)
            throw new Error(`Model returned no JSON. Response: ${responseText.slice(0, 200)}`);
        const extracted = JSON.parse(jsonMatch[0]);
        const fieldMap = new Map(fields.map((f) => [f.field_name, f.id]));
        const toSave = [];
        for (const [fieldName, value] of Object.entries(extracted)) {
            const fieldId = fieldMap.get(fieldName);
            if (fieldId)
                toSave.push({ field_id: fieldId, value: String(value) });
        }
        (0, db_1.transaction)(() => {
            for (const { field_id, value } of toSave) {
                const existing = db_1.default.prepare('SELECT id FROM extraction_data WHERE article_id = ? AND field_id = ? AND user_id = ?')
                    .get(req.params.articleId, field_id, req.user.id);
                if (existing) {
                    db_1.default.prepare(`UPDATE extraction_data SET value = ?, updated_at = datetime('now') WHERE id = ?`).run(value, existing.id);
                }
                else {
                    db_1.default.prepare('INSERT INTO extraction_data (id, article_id, review_id, user_id, field_id, value) VALUES (?, ?, ?, ?, ?, ?)')
                        .run((0, uuid_1.v4)(), req.params.articleId, req.params.reviewId, req.user.id, field_id, value);
                }
            }
        });
        (0, gamification_1.awardPoints)(req.user.id, gamification_1.POINTS.EXTRACT_DATA * 2, req.params.reviewId);
        res.json({ success: true, extracted, citation, fields_populated: toSave.length, model: OLLAMA_MODEL, content_source: contentSource });
    }
    catch (err) {
        console.error('AI extraction error:', err.message);
        if (err.message?.includes('ECONNREFUSED')) {
            return res.status(503).json({ error: 'Ollama not running', message: 'Start Ollama with: ollama serve' });
        }
        res.status(500).json({ error: 'AI extraction failed', message: err.message });
    }
});
exports.default = router;
