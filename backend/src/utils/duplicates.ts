export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
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
  const na = normalizeTitle(a), nb = normalizeTitle(b);
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

export interface Article {
  id: string;
  title: string;
  authors: string;
  year?: number;
  doi?: string;
  pmid?: string;
  journal?: string;
}

export interface DuplicatePair {
  article1Id: string;
  article2Id: string;
  similarity: number;
  matchReason: string;
}

export function detectDuplicates(articles: Article[]): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];

  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      const a = articles[i];
      const b = articles[j];
      let similarity = 0;
      let reason = '';

      // Exact DOI match
      if (a.doi && b.doi && a.doi.trim() && b.doi.trim() &&
          a.doi.toLowerCase().trim() === b.doi.toLowerCase().trim()) {
        pairs.push({ article1Id: a.id, article2Id: b.id, similarity: 1.0, matchReason: 'Exact DOI match' });
        continue;
      }

      // Exact PMID match
      if (a.pmid && b.pmid && a.pmid.trim() && b.pmid.trim() &&
          a.pmid.trim() === b.pmid.trim()) {
        pairs.push({ article1Id: a.id, article2Id: b.id, similarity: 1.0, matchReason: 'Exact PMID match' });
        continue;
      }

      // Title similarity
      const titleSim = titleSimilarity(a.title, b.title);
      const jaccardSim = jaccardSimilarity(a.title, b.title);
      const combinedTitleSim = (titleSim * 0.6 + jaccardSim * 0.4);

      if (combinedTitleSim >= 0.85) {
        similarity = combinedTitleSim;
        reason = `Title similarity: ${Math.round(combinedTitleSim * 100)}%`;

        // Boost if same year
        if (a.year && b.year && a.year === b.year) {
          similarity = Math.min(1.0, similarity + 0.05);
          reason += ', same year';
        }

        // Boost if same journal
        if (a.journal && b.journal) {
          const journalSim = titleSimilarity(a.journal, b.journal);
          if (journalSim > 0.8) {
            similarity = Math.min(1.0, similarity + 0.05);
            reason += ', same journal';
          }
        }

        if (similarity >= 0.85) {
          pairs.push({ article1Id: a.id, article2Id: b.id, similarity, matchReason: reason });
        }
      }
    }
  }

  return pairs;
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
