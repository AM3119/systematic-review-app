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

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function fetchUrl(url: string, opts: { followRedirects?: number; maxSize?: number } = {}): Promise<{ body: Buffer; contentType: string; finalUrl: string }> {
  return new Promise((resolve, reject) => {
    const maxRedirects = opts.followRedirects ?? 5;
    const maxSize = opts.maxSize ?? 20 * 1024 * 1024; // 20 MB

    const makeReq = (target: string, redirectsLeft: number) => {
      const mod = target.startsWith('https') ? https : http;
      const req = mod.get(target, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/pdf,application/xhtml+xml,*/*',
        },
        timeout: 20000,
      }, (res) => {
        const status = res.statusCode || 0;
        // Follow redirects
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          const next = res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, target).href;
          makeReq(next, redirectsLeft - 1);
          return;
        }
        if (status < 200 || status >= 300) { res.resume(); reject(new Error(`HTTP ${status} for ${target}`)); return; }

        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxSize) { req.destroy(); reject(new Error('Response too large')); return; }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({
          body: Buffer.concat(chunks),
          contentType: res.headers['content-type'] || '',
          finalUrl: target,
        }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    };
    makeReq(url, maxRedirects);
  });
}

function isPdf(buf: Buffer): boolean {
  return buf.slice(0, 4).toString('ascii') === '%PDF';
}

async function downloadPdfToFile(url: string, dest: string): Promise<boolean> {
  try {
    const { body, contentType } = await fetchUrl(url, { maxSize: 50 * 1024 * 1024 });
    if (!isPdf(body)) return false;
    fs.writeFileSync(dest, body);
    return true;
  } catch {
    return false;
  }
}

function savePdf(buf: Buffer, pdfDir: string, prefix: string): string {
  const fname = `${prefix}-${uuidv4()}.pdf`;
  fs.writeFileSync(path.join(pdfDir, fname), buf);
  return `/api/pdfs/${fname}`;
}

// ─── Source 1: Unpaywall ─────────────────────────────────────────────────────

async function tryUnpaywall(doi: string, pdfDir: string): Promise<FetchResult> {
  if (!doi) return { found: false };
  try {
    const email = process.env.UNPAYWALL_EMAIL || 'researcher@example.com';
    const { body } = await fetchUrl(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${email}`);
    const data = JSON.parse(body.toString());
    const loc = data.best_oa_location;
    const pdfUrl = loc?.url_for_pdf || loc?.url_for_landing_page;
    if (!pdfUrl) return { found: false };
    // Prefer direct PDF link
    const target = loc?.url_for_pdf || pdfUrl;
    const { body: pdfBuf } = await fetchUrl(target, { maxSize: 50 * 1024 * 1024 });
    if (!isPdf(pdfBuf)) return { found: false };
    const url = savePdf(pdfBuf, pdfDir, 'unpaywall');
    return { found: true, url, source: 'Unpaywall' };
  } catch { return { found: false }; }
}

// ─── Source 2: Europe PMC ────────────────────────────────────────────────────

async function tryEuropePMC(article: any, pdfDir: string): Promise<FetchResult> {
  try {
    const query = article.pmid
      ? `EXT_ID:${article.pmid} AND SRC:MED`
      : `DOI:"${article.doi}"`;
    const { body } = await fetchUrl(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=1`);
    const data = JSON.parse(body.toString());
    const hit = data.resultList?.result?.[0];
    if (!hit) return { found: false };

    // Try PMC full-text PDF
    if (hit.pmcid) {
      const pmcUrl = `https://europepmc.org/articles/${hit.pmcid}?pdf=render`;
      try {
        const { body: pdfBuf } = await fetchUrl(pmcUrl, { maxSize: 50 * 1024 * 1024 });
        if (isPdf(pdfBuf)) {
          const url = savePdf(pdfBuf, pdfDir, 'europepmc');
          return { found: true, url, source: 'Europe PMC' };
        }
      } catch {}

      // Try direct PMC PDF download
      const directUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/${hit.pmcid}/pdf/`;
      try {
        const { body: pdfBuf } = await fetchUrl(directUrl, { maxSize: 50 * 1024 * 1024 });
        if (isPdf(pdfBuf)) {
          const url = savePdf(pdfBuf, pdfDir, 'pmc');
          return { found: true, url, source: 'PubMed Central' };
        }
      } catch {}
    }
    return { found: false };
  } catch { return { found: false }; }
}

// ─── Source 3: Semantic Scholar ──────────────────────────────────────────────

async function trySemanticScholar(article: any, pdfDir: string): Promise<FetchResult> {
  try {
    const query = article.doi
      ? `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(article.doi)}?fields=openAccessPdf,title`
      : `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(article.title || '')}&fields=openAccessPdf&limit=1`;

    const { body } = await fetchUrl(query);
    const data = JSON.parse(body.toString());
    const pdfUrl = data.openAccessPdf?.url || data.data?.[0]?.openAccessPdf?.url;
    if (!pdfUrl) return { found: false };

    const { body: pdfBuf } = await fetchUrl(pdfUrl, { maxSize: 50 * 1024 * 1024 });
    if (!isPdf(pdfBuf)) return { found: false };
    const url = savePdf(pdfBuf, pdfDir, 'semanticscholar');
    return { found: true, url, source: 'Semantic Scholar' };
  } catch { return { found: false }; }
}

// ─── Source 4: Sci-Hub ───────────────────────────────────────────────────────

const SCIHUB_MIRRORS = [
  'https://sci-hub.se',
  'https://sci-hub.st',
  'https://sci-hub.ru',
];

async function tryScihub(article: any, pdfDir: string): Promise<FetchResult> {
  const identifier = article.doi || article.pmid;
  if (!identifier) return { found: false };

  for (const mirror of SCIHUB_MIRRORS) {
    try {
      const pageUrl = `${mirror}/${encodeURIComponent(identifier)}`;
      const { body: pageBody } = await fetchUrl(pageUrl);
      const html = pageBody.toString();

      // Extract PDF src from iframe or embed
      const pdfMatch =
        html.match(/(?:iframe|embed)[^>]+src=["']([^"']*\.pdf[^"']*)/i) ||
        html.match(/(?:iframe|embed)[^>]+src=["'](\/\/[^"']+)/i) ||
        html.match(/<iframe[^>]+src=["']([^"']+)["']/i) ||
        html.match(/download\s*href=["']([^"']+\.pdf[^"']*)/i) ||
        html.match(/location\.href\s*=\s*['"]([^'"]+\.pdf[^'"]*)/i) ||
        html.match(/onclick="[^"]*location\.href='([^']+)'/i);

      if (!pdfMatch?.[1]) continue;

      let pdfUrl = pdfMatch[1];
      // Handle protocol-relative URLs
      if (pdfUrl.startsWith('//')) pdfUrl = 'https:' + pdfUrl;
      // Handle relative URLs
      if (pdfUrl.startsWith('/')) pdfUrl = mirror + pdfUrl;
      // Clean up query params that block downloads
      pdfUrl = pdfUrl.split('#')[0];

      const { body: pdfBuf } = await fetchUrl(pdfUrl, { maxSize: 50 * 1024 * 1024 });
      if (!isPdf(pdfBuf)) continue;

      const url = savePdf(pdfBuf, pdfDir, 'scihub');
      return { found: true, url, source: 'Sci-Hub' };
    } catch { continue; }
  }
  return { found: false };
}

// ─── Source 5: Anna's Archive ────────────────────────────────────────────────

async function tryAnnasArchive(article: any, pdfDir: string): Promise<FetchResult> {
  const doi = article.doi;
  if (!doi) return { found: false };
  try {
    // Search Anna's Archive for the DOI
    const searchUrl = `https://annas-archive.org/search?index=&q=${encodeURIComponent(doi)}&ext=pdf&sort=&lang=en`;
    const { body: searchBody } = await fetchUrl(searchUrl);
    const html = searchBody.toString();

    // Find first book/paper link
    const mdMatch = html.match(/href="(\/md5\/[a-f0-9]+)"/i);
    if (!mdMatch) return { found: false };

    const detailUrl = `https://annas-archive.org${mdMatch[1]}`;
    const { body: detailBody } = await fetchUrl(detailUrl);
    const detailHtml = detailBody.toString();

    // Find a direct download link
    const dlMatch =
      detailHtml.match(/href="(https?:\/\/[^"]+\.pdf[^"]*)"/i) ||
      detailHtml.match(/href="(\/fast_download\/[^"]+)"/i) ||
      detailHtml.match(/href="(\/slow_download\/[^"]+)"/i);

    if (!dlMatch) return { found: false };

    let dlUrl = dlMatch[1];
    if (dlUrl.startsWith('/')) dlUrl = 'https://annas-archive.org' + dlUrl;

    const { body: pdfBuf } = await fetchUrl(dlUrl, { maxSize: 50 * 1024 * 1024 });
    if (!isPdf(pdfBuf)) return { found: false };

    const url = savePdf(pdfBuf, pdfDir, 'annas');
    return { found: true, url, source: "Anna's Archive" };
  } catch { return { found: false }; }
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function fetchFullText(article: any, pdfDir: string): Promise<FetchResult> {
  const sources = [
    () => tryUnpaywall(article.doi, pdfDir),
    () => tryEuropePMC(article, pdfDir),
    () => trySemanticScholar(article, pdfDir),
    () => tryScihub(article, pdfDir),
    () => tryAnnasArchive(article, pdfDir),
  ];

  for (const trySource of sources) {
    const result = await trySource();
    if (result.found) return result;
  }

  return { found: false, message: 'Not found on Unpaywall, Europe PMC, Semantic Scholar, Sci-Hub, or Anna\'s Archive' };
}
