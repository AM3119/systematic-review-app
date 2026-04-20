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

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': 'SystematicAI/1.0 (academic research tool; mailto:researcher@example.com)' },
      timeout: 10000
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(httpsGet(res.headers.location));
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function downloadPdf(url: string, dest: string): Promise<boolean> {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': 'SystematicAI/1.0 (academic research tool)' },
      timeout: 30000
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(dest, () => {});
        return downloadPdf(res.headers.location!, dest).then(r => resolve(r));
      }
      const contentType = res.headers['content-type'] || '';
      if (!contentType.includes('pdf') && !contentType.includes('octet-stream')) {
        file.close();
        fs.unlink(dest, () => {});
        return resolve(false);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(true); });
      file.on('error', () => { fs.unlink(dest, () => {}); resolve(false); });
    });
    req.on('error', () => { fs.unlink(dest, () => {}); resolve(false); });
    req.on('timeout', () => { req.destroy(); file.close(); fs.unlink(dest, () => {}); resolve(false); });
  });
}

// ── 1. Unpaywall ────────────────────────────────────────────────────────────
async function tryUnpaywall(doi: string): Promise<string | null> {
  if (!doi) return null;
  try {
    const email = process.env.UNPAYWALL_EMAIL || 'researcher@example.com';
    const data = await httpsGet(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${email}`);
    const json = JSON.parse(data);
    const loc = json?.best_oa_location;
    return loc?.url_for_pdf || loc?.url || null;
  } catch { return null; }
}

// ── 2. Europe PMC ───────────────────────────────────────────────────────────
async function tryEuropePMC(pmid: string, doi: string): Promise<string | null> {
  try {
    const query = pmid ? `ext_id:${pmid}` : doi ? `doi:${doi}` : null;
    if (!query) return null;
    const data = await httpsGet(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&resultType=core&format=json&pageSize=1`);
    const json = JSON.parse(data);
    const result = json?.resultList?.result?.[0];
    if (!result) return null;
    // Check for open access PDF
    if (result.isOpenAccess === 'Y' && result.pmcid) {
      return `https://europepmc.org/articles/${result.pmcid}/pdf`;
    }
    return null;
  } catch { return null; }
}

// ── 3. PubMed Central ───────────────────────────────────────────────────────
async function tryPubMedCentral(pmid: string): Promise<string | null> {
  if (!pmid) return null;
  try {
    // Convert PMID to PMCID
    const data = await httpsGet(`https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids=${pmid}&format=json`);
    const json = JSON.parse(data);
    const pmcid = json?.records?.[0]?.pmcid;
    if (!pmcid) return null;
    return `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/pdf/`;
  } catch { return null; }
}

// ── 4. Semantic Scholar ─────────────────────────────────────────────────────
async function trySemanticScholar(doi: string, title: string): Promise<string | null> {
  try {
    const query = doi ? `DOI:${doi}` : encodeURIComponent(title.slice(0, 80));
    const data = await httpsGet(`https://api.semanticscholar.org/graph/v1/paper/${doi ? `DOI:${doi}` : `search?query=${encodeURIComponent(title.slice(0, 80))}&fields=openAccessPdf&limit=1`}`);
    const json = JSON.parse(data);
    if (doi) {
      return json?.openAccessPdf?.url || null;
    }
    return json?.data?.[0]?.openAccessPdf?.url || null;
  } catch { return null; }
}

// ── Main orchestrator ───────────────────────────────────────────────────────
export async function fetchFullText(article: any, pdfDir: string): Promise<FetchResult> {
  const { doi, pmid, title } = article;
  const sources = [
    { name: 'Unpaywall', fn: () => tryUnpaywall(doi) },
    { name: 'Europe PMC', fn: () => tryEuropePMC(pmid, doi) },
    { name: 'PubMed Central', fn: () => tryPubMedCentral(pmid) },
    { name: 'Semantic Scholar', fn: () => trySemanticScholar(doi, title) },
  ];

  for (const source of sources) {
    let pdfUrl: string | null = null;
    try { pdfUrl = await source.fn(); } catch {}
    if (!pdfUrl) continue;

    // Try to download
    const filename = `${uuidv4()}.pdf`;
    const dest = path.join(pdfDir, filename);
    const downloaded = await downloadPdf(pdfUrl, dest);

    if (downloaded) {
      return { found: true, url: `/api/pdfs/${filename}`, source: source.name };
    }
    // PDF URL found but couldn't download — still return the external link
    return { found: true, url: pdfUrl, source: `${source.name} (external link)` };
  }

  return {
    found: false,
    message: 'No open-access full text found. Please upload the PDF manually.'
  };
}
