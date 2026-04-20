export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

export function titleSimilarity(a: string, b: string): number {
  const na = normalizeText(a), nb = normalizeText(b);
  if (na === nb) return 1.0;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1.0;
  return 1 - levenshtein(na, nb) / maxLen;
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const setB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

// Truncate long abstracts for comparison to avoid O(n²) on huge texts
function abstractSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const ca = a.slice(0, 500);
  const cb = b.slice(0, 500);
  // Use Jaccard on word sets (fast for long text)
  return jaccardSimilarity(ca, cb);
}

export interface Article {
  id: string;
  title: string;
  authors: string;
  year?: number;
  doi?: string;
  pmid?: string;
  journal?: string;
  abstract?: string;
}

export interface DuplicatePair {
  article1Id: string;
  article2Id: string;
  similarity: number;
  titleSim: number;
  abstractSim: number;
  matchReason: string;
}

// Pre-compute word sets for all articles once (avoids O(n²) re-splitting)
function buildIndex(articles: Article[]) {
  return articles.map(a => ({
    ...a,
    titleWords: new Set(normalizeText(a.title || '').split(/\s+/).filter(w => w.length > 2)),
    abstractWords: new Set((a.abstract || '').slice(0, 400).toLowerCase().split(/\s+/).filter(w => w.length > 3)),
    titleNorm: normalizeText(a.title || ''),
    doiNorm: (a.doi || '').toLowerCase().trim(),
    pmidNorm: (a.pmid || '').trim(),
  }));
}

function fastJaccardSets(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  const smaller = setA.size <= setB.size ? setA : setB;
  const larger = setA.size <= setB.size ? setB : setA;
  for (const w of smaller) { if (larger.has(w)) intersection++; }
  return intersection / (setA.size + setB.size - intersection);
}

export function detectDuplicates(articles: Article[], threshold = 0.85): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  const indexed = buildIndex(articles);
  // How much title Jaccard alone can contribute to the final score (title 70% weight)
  // If max possible final score < threshold, skip expensive Levenshtein
  const minJaccardToCheck = threshold / 1.06 - 0.30; // rough lower bound

  for (let i = 0; i < indexed.length; i++) {
    const a = indexed[i];
    for (let j = i + 1; j < indexed.length; j++) {
      const b = indexed[j];

      // Exact DOI match → 100%
      if (a.doiNorm && b.doiNorm && a.doiNorm === b.doiNorm) {
        pairs.push({ article1Id: a.id, article2Id: b.id, similarity: 1.0, titleSim: 1.0, abstractSim: 0, matchReason: 'Exact DOI match' });
        continue;
      }
      // Exact PMID match → 100%
      if (a.pmidNorm && b.pmidNorm && a.pmidNorm === b.pmidNorm) {
        pairs.push({ article1Id: a.id, article2Id: b.id, similarity: 1.0, titleSim: 1.0, abstractSim: 0, matchReason: 'Exact PMID match' });
        continue;
      }

      // Fast Jaccard pre-filter — skip pairs that can't possibly meet threshold
      const jac = fastJaccardSets(a.titleWords, b.titleWords);
      if (jac < minJaccardToCheck) continue;

      // Full title similarity
      const lev = titleSimilarity(a.titleNorm, b.titleNorm);
      const titleSim = lev * 0.6 + jac * 0.4;

      // Abstract similarity
      const abstractSim = fastJaccardSets(a.abstractWords, b.abstractWords);

      // Combined score
      let similarity = titleSim * 0.70 + abstractSim * 0.30;

      const reasons: string[] = [`Title: ${Math.round(titleSim * 100)}%`];
      if (a.abstract && b.abstract) reasons.push(`Abstract: ${Math.round(abstractSim * 100)}%`);

      // Boosters
      if (a.year && b.year && a.year === b.year) {
        similarity = Math.min(1.0, similarity + 0.03);
        reasons.push('same year');
      }
      if (a.journal && b.journal && fastJaccardSets(
        new Set(a.journal.toLowerCase().split(/\s+/)),
        new Set(b.journal.toLowerCase().split(/\s+/))
      ) > 0.7) {
        similarity = Math.min(1.0, similarity + 0.03);
        reasons.push('same journal');
      }

      if (similarity >= threshold) {
        pairs.push({ article1Id: a.id, article2Id: b.id, similarity, titleSim, abstractSim, matchReason: reasons.join(', ') });
      }
    }
  }

  return pairs.sort((a, b) => b.similarity - a.similarity);
}

export function groupDuplicates(pairs: DuplicatePair[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  const articleToGroup = new Map<string, string>();

  for (const pair of pairs) {
    const g1 = articleToGroup.get(pair.article1Id);
    const g2 = articleToGroup.get(pair.article2Id);

    if (!g1 && !g2) {
      const groupId = pair.article1Id;
      groups.set(groupId, [pair.article1Id, pair.article2Id]);
      articleToGroup.set(pair.article1Id, groupId);
      articleToGroup.set(pair.article2Id, groupId);
    } else if (g1 && !g2) {
      groups.get(g1)!.push(pair.article2Id);
      articleToGroup.set(pair.article2Id, g1);
    } else if (!g1 && g2) {
      groups.get(g2)!.push(pair.article1Id);
      articleToGroup.set(pair.article1Id, g2);
    } else if (g1 && g2 && g1 !== g2) {
      const merged = [...groups.get(g1)!, ...groups.get(g2)!];
      groups.delete(g2);
      groups.set(g1, merged);
      for (const id of merged) articleToGroup.set(id, g1);
    }
  }

  return groups;
}
