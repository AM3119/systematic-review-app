import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface FetchResult {
  found: boolean;
  url?: string;
  source?: string;
  message?: string;
}

// ─── Core HTTP ────────────────────────────────────────────────────────────────

function get(url: string, timeoutMs = 12000): Promise<{ body: Buffer; ct: string; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    const attempt = (target: string, hops: number) => {
      if (hops > 6) return reject(new Error('Too many redirects'));
      const mod = target.startsWith('https') ? https : http;
      const req = mod.get(target, {
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          'Accept': 'application/pdf,text/html,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode!) && res.headers.location) {
          res.resume();
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, target).href;
          return attempt(next, hops + 1);
        }
        if ((res.statusCode ?? 0) >= 400) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        const chunks: Buffer[] = [];
        let sz = 0;
        res.on('data', (c: Buffer) => { sz += c.length; if (sz > 52_428_800) { req.destroy(); reject(new Error('Too large')); } else chunks.push(c); });
        res.on('end', () => resolve({ body: Buffer.concat(chunks), ct: res.headers['content-type'] || '', finalUrl: target }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    };
    attempt(url, 0);
  });
}

const isPdf = (buf: Buffer) => buf.length > 4 && buf.slice(0, 4).toString() === '%PDF';

function save(buf: Buffer, dir: string, tag: string): string {
  const name = `${tag}-${uuidv4()}.pdf`;
  fs.writeFileSync(path.join(dir, name), buf);
  return `/api/pdfs/${name}`;
}

// Normalise Unicode diacritics so accented chars match their base letters (e.g. é→e)
function normDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Verify that the PDF actually contains words from the article title (avoids wrong PDFs).
// Uses ≥5-char words so common short medical words ("study","risk") don't produce false positives.
// Requires 60% of significant title words to appear in the PDF text.
async function verifyPdfTitle(buf: Buffer, title: string): Promise<boolean> {
  if (!title) return true;
  try {
    const pdfParse = require('pdf-parse/lib/pdf-parse.js');
    const data = await pdfParse(buf, { max: 2 }); // first 2 pages only
    const text = normDiacritics((data.text || '').toLowerCase());
    const words = normDiacritics(title.toLowerCase())
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 5); // only substantive words (≥5 chars)
    if (!words.length) return true; // very short title — can't verify, allow it
    const matched = words.filter(w => text.includes(w));
    return matched.length / words.length >= 0.6; // 60% of title words must appear
  } catch {
    return true; // if PDF parsing fails, allow (better than blocking valid PDFs)
  }
}

async function tryPdfUrl(url: string, dir: string, tag: string): Promise<string | null> {
  try {
    const { body } = await get(url);
    if (!isPdf(body)) return null;
    return save(body, dir, tag);
  } catch { return null; }
}

// Like tryPdfUrl but also verifies title match before saving
async function tryPdfUrlVerified(url: string, dir: string, tag: string, title: string): Promise<string | null> {
  try {
    const { body } = await get(url);
    if (!isPdf(body)) return null;
    const valid = await verifyPdfTitle(body, title);
    if (!valid) return null;
    return save(body, dir, tag);
  } catch { return null; }
}

// ─── Individual sources ───────────────────────────────────────────────────────

async function unpaywall(doi: string, dir: string, title: string): Promise<FetchResult> {
  if (!doi) return { found: false };
  try {
    const email = process.env.UNPAYWALL_EMAIL || 'researcher@example.com';
    const { body } = await get(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${email}`, 8000);
    const d = JSON.parse(body.toString());
    const loc = d.best_oa_location;
    const pdfUrl = loc?.url_for_pdf;
    if (!pdfUrl) return { found: false };
    const local = await tryPdfUrlVerified(pdfUrl, dir, 'unpaywall', title);
    if (local) return { found: true, url: local, source: 'Unpaywall' };
  } catch {}
  return { found: false };
}

async function europePmc(article: any, dir: string): Promise<FetchResult> {
  try {
    const q = article.pmid ? `EXT_ID:${article.pmid} AND SRC:MED` : `DOI:"${article.doi}"`;
    const { body } = await get(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(q)}&format=json&resultType=core&pageSize=1`, 8000);
    const hit = JSON.parse(body.toString()).resultList?.result?.[0];
    if (!hit?.pmcid) return { found: false };
    // Try multiple PMC URL patterns
    for (const url of [
      `https://www.ncbi.nlm.nih.gov/pmc/articles/${hit.pmcid}/pdf/`,
      `https://europepmc.org/articles/${hit.pmcid}?pdf=render`,
      `https://pmc.ncbi.nlm.nih.gov/articles/${hit.pmcid}/pdf/`,
    ]) {
      const local = await tryPdfUrlVerified(url, dir, 'pmc', article.title || '');
      if (local) return { found: true, url: local, source: 'PubMed Central' };
    }
  } catch {}
  return { found: false };
}

async function semanticScholar(article: any, dir: string): Promise<FetchResult> {
  try {
    const endpoint = article.doi
      ? `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(article.doi)}?fields=openAccessPdf,title`
      : `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(article.title || '')}&fields=openAccessPdf,title&limit=1`;
    const { body } = await get(endpoint, 8000);
    const d = JSON.parse(body.toString());
    const hit = d.data?.[0] || d;
    const pdfUrl = hit.openAccessPdf?.url;
    if (!pdfUrl) return { found: false };
    // For title-search results (no DOI), do an API-level title check before downloading
    if (!article.doi && hit.title) {
      const aNorm = normDiacritics((article.title || '').toLowerCase()).replace(/[^a-z0-9\s]/g, '');
      const bNorm = normDiacritics((hit.title || '').toLowerCase()).replace(/[^a-z0-9\s]/g, '');
      const aWords = new Set(aNorm.split(/\s+/).filter((w: string) => w.length >= 4));
      const bWords = new Set(bNorm.split(/\s+/).filter((w: string) => w.length >= 4));
      const intersection = [...aWords].filter(w => bWords.has(w)).length;
      const union = new Set([...aWords, ...bWords]).size;
      const jaccard = union > 0 ? intersection / union : 0;
      if (jaccard < 0.5) return { found: false }; // Different paper — skip
    }
    const local = await tryPdfUrlVerified(pdfUrl, dir, 'ss', article.title || '');
    if (local) return { found: true, url: local, source: 'Semantic Scholar' };
  } catch {}
  return { found: false };
}

async function arxiv(article: any, dir: string): Promise<FetchResult> {
  if (!article.doi && !article.title) return { found: false };
  try {
    // Check if DOI points to arXiv
    const doi = article.doi || '';
    if (doi.includes('arxiv') || doi.includes('10.48550')) {
      const arxivId = doi.split('arxiv.')[1] || doi.split('/').pop();
      if (arxivId) {
        const local = await tryPdfUrl(`https://arxiv.org/pdf/${arxivId}`, dir, 'arxiv');
        if (local) return { found: true, url: local, source: 'arXiv' };
      }
    }
    // Search by title
    const q = encodeURIComponent((article.title || '').slice(0, 100));
    const { body } = await get(`https://export.arxiv.org/api/query?search_query=ti:${q}&max_results=1`, 8000);
    const xml = body.toString();
    const idMatch = xml.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/);
    if (!idMatch) return { found: false };
    const local = await tryPdfUrlVerified(`https://arxiv.org/pdf/${idMatch[1]}`, dir, 'arxiv', article.title || '');
    if (local) return { found: true, url: local, source: 'arXiv' };
  } catch {}
  return { found: false };
}

async function biorxiv(article: any, dir: string): Promise<FetchResult> {
  if (!article.doi) return { found: false };
  try {
    // bioRxiv/medRxiv DOIs start with 10.1101
    if (!article.doi.startsWith('10.1101')) return { found: false };
    const local = await tryPdfUrlVerified(`https://www.biorxiv.org/content/${article.doi}.full.pdf`, dir, 'biorxiv', article.title || '');
    if (local) return { found: true, url: local, source: 'bioRxiv' };
    const local2 = await tryPdfUrlVerified(`https://www.medrxiv.org/content/${article.doi}.full.pdf`, dir, 'medrxiv', article.title || '');
    if (local2) return { found: true, url: local2, source: 'medRxiv' };
  } catch {}
  return { found: false };
}

async function coreAc(article: any, dir: string): Promise<FetchResult> {
  try {
    const q = article.doi
      ? `doi:"${article.doi}"`
      : `title:"${(article.title || '').slice(0, 80)}"`;
    const { body } = await get(`https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(q)}&limit=1&fields=downloadUrl,fullTextIdentifier,title`, 8000);
    const d = JSON.parse(body.toString());
    const hit = d.results?.[0];
    const pdfUrl = hit?.downloadUrl || hit?.fullTextIdentifier;
    if (!pdfUrl) return { found: false };
    // For title-search results (no DOI), do an API-level title sanity check
    if (!article.doi && hit?.title) {
      const aNorm = normDiacritics((article.title || '').toLowerCase()).replace(/[^a-z0-9\s]/g, '');
      const bNorm = normDiacritics((hit.title || '').toLowerCase()).replace(/[^a-z0-9\s]/g, '');
      const aWords = new Set(aNorm.split(/\s+/).filter((w: string) => w.length >= 4));
      const bWords = new Set(bNorm.split(/\s+/).filter((w: string) => w.length >= 4));
      const intersection = [...aWords].filter(w => bWords.has(w)).length;
      const union = new Set([...aWords, ...bWords]).size;
      const jaccard = union > 0 ? intersection / union : 0;
      if (jaccard < 0.5) return { found: false }; // Different paper — skip
    }
    const local = await tryPdfUrlVerified(pdfUrl, dir, 'core', article.title || '');
    if (local) return { found: true, url: local, source: 'CORE' };
  } catch {}
  return { found: false };
}

// Sci-Hub: try all mirrors in parallel, first valid PDF wins
async function scihub(article: any, dir: string): Promise<FetchResult> {
  const id = article.doi || article.pmid;
  if (!id) return { found: false };
  const mirrors = ['https://sci-hub.se', 'https://sci-hub.st', 'https://sci-hub.ru', 'https://sci-hub.mksa.top'];

  const tryMirror = async (base: string): Promise<FetchResult> => {
    try {
      const { body: html } = await get(`${base}/${encodeURIComponent(id)}`, 12000);
      const text = html.toString();
      // Multiple regex patterns to catch different Sci-Hub layouts
      const patterns = [
        /(?:src|href)=["']([^"']+\.pdf[^"'?#]*)/gi,
        /<iframe[^>]+src=["']([^"']+)["']/gi,
        /<embed[^>]+src=["']([^"']+)["']/gi,
        /location\.href\s*=\s*["']([^"']+\.pdf[^"']*)/gi,
        /download\s*=\s*["'][^"']*["'][^>]+href=["']([^"']+)/gi,
      ];
      let pdfUrl: string | null = null;
      for (const pat of patterns) {
        const m = pat.exec(text);
        if (m?.[1]) { pdfUrl = m[1]; break; }
      }
      if (!pdfUrl) return { found: false };
      if (pdfUrl.startsWith('//')) pdfUrl = 'https:' + pdfUrl;
      if (pdfUrl.startsWith('/')) pdfUrl = base + pdfUrl;
      const local = await tryPdfUrlVerified(pdfUrl, dir, 'scihub', article.title || '');
      if (local) return { found: true, url: local, source: 'Sci-Hub' };
    } catch {}
    return { found: false };
  };

  // Race all mirrors in parallel
  try {
    const result = await Promise.any(
      mirrors.map(m => tryMirror(m).then(r => r.found ? r : Promise.reject('not found')))
    );
    return result;
  } catch { return { found: false }; }
}

async function annasArchive(article: any, dir: string): Promise<FetchResult> {
  const doi = article.doi;
  if (!doi) return { found: false };
  try {
    const { body: searchHtml } = await get(
      `https://annas-archive.org/search?index=&q=${encodeURIComponent(doi)}&ext=pdf&sort=&lang=en`, 10000
    );
    const html = searchHtml.toString();
    const mdMatch = html.match(/href="(\/md5\/[a-f0-9]+)"/i);
    if (!mdMatch) return { found: false };
    const { body: detailHtml } = await get(`https://annas-archive.org${mdMatch[1]}`, 10000);
    const detail = detailHtml.toString();
    const dlMatch =
      detail.match(/href="(https?:\/\/[^"]+\.pdf[^"]*)"/i) ||
      detail.match(/href="(\/fast_download\/[^"]+)"/i) ||
      detail.match(/href="(\/slow_download\/[^"]+)"/i);
    if (!dlMatch) return { found: false };
    let dlUrl = dlMatch[1];
    if (dlUrl.startsWith('/')) dlUrl = 'https://annas-archive.org' + dlUrl;
    const local = await tryPdfUrlVerified(dlUrl, dir, 'annas', article.title || '');
    if (local) return { found: true, url: local, source: "Anna's Archive" };
  } catch {}
  return { found: false };
}

// ─── Main: race all sources in parallel ──────────────────────────────────────

export async function fetchFullText(article: any, pdfDir: string): Promise<FetchResult> {
  // Group 1: Fast open-access sources (run together first)
  const oaSources = [
    unpaywall(article.doi, pdfDir, article.title || ''),
    europePmc(article, pdfDir),
    semanticScholar(article, pdfDir),
    arxiv(article, pdfDir),
    biorxiv(article, pdfDir),
    coreAc(article, pdfDir),
  ];

  // Try OA sources first (race — first found wins)
  try {
    const result = await Promise.any(
      oaSources.map(p => p.then(r => r.found ? r : Promise.reject('not found')))
    );
    return result;
  } catch {
    // All OA failed — fall back to Sci-Hub + Anna's Archive in parallel
    try {
      const result = await Promise.any([
        scihub(article, pdfDir).then(r => r.found ? r : Promise.reject('not found')),
        annasArchive(article, pdfDir).then(r => r.found ? r : Promise.reject('not found')),
      ]);
      return result;
    } catch {
      return { found: false, message: 'Not found on any source (Unpaywall, PMC, Semantic Scholar, arXiv, bioRxiv, CORE, Sci-Hub, Anna\'s Archive)' };
    }
  }
}
