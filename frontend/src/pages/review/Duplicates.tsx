import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from 'react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { articlesApi } from '../../api/client';
import { SparklesIcon, CheckIcon, DocumentDuplicateIcon } from '@heroicons/react/24/outline';

function SimilarityBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 95 ? 'bg-red-500' : pct >= 85 ? 'bg-orange-400' : 'bg-yellow-400';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-bold w-10 text-right ${pct >= 95 ? 'text-red-600 dark:text-red-400' : pct >= 85 ? 'text-orange-600 dark:text-orange-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
        {pct}%
      </span>
    </div>
  );
}

export default function Duplicates() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const qc = useQueryClient();
  const [detecting, setDetecting] = useState(false);
  const [threshold, setThreshold] = useState(0.80);
  const [expandedAbstracts, setExpandedAbstracts] = useState<Set<string>>(new Set());

  const { data: groups = [], refetch } = useQuery(
    ['duplicate-groups', reviewId],
    () => articlesApi.duplicateGroups(reviewId!).then(r => r.data),
    { enabled: !!reviewId }
  );

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const { data } = await articlesApi.detectDuplicates(reviewId!, threshold);
      toast.success(`Found ${data.duplicates_found} duplicate${data.duplicates_found !== 1 ? 's' : ''} across ${data.groups} group${data.groups !== 1 ? 's' : ''} — they are now hidden from screening`);
      refetch();
      // Invalidate article lists so abstract/fulltext screening immediately reflects the new filtering
      qc.invalidateQueries(['articles', reviewId]);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Detection failed');
    } finally {
      setDetecting(false);
    }
  };

  const setPrimary = async (articleId: string, groupId: string, groupArticles: any[]) => {
    try {
      await Promise.all(groupArticles.map(a =>
        articlesApi.setDuplicate(reviewId!, a.id, {
          is_duplicate_primary: a.id === articleId ? 1 : 0,
          duplicate_group_id: groupId,
        })
      ));
      toast.success('Primary article updated — screening list refreshed');
      refetch();
      qc.invalidateQueries(['articles', reviewId]);
    } catch { toast.error('Failed to update'); }
  };

  const keepBoth = async (groupId: string, groupArticles: any[]) => {
    try {
      await Promise.all(groupArticles.map(a =>
        articlesApi.setDuplicate(reviewId!, a.id, { is_duplicate_primary: 1, duplicate_group_id: null })
      ));
      toast.success('Both articles kept as unique');
      refetch();
      qc.invalidateQueries(['articles', reviewId]);
    } catch { toast.error('Failed'); }
  };

  const thresholdLabel = threshold >= 0.98 ? 'Exact match only' : threshold >= 0.95 ? 'Very strict (95%+)' : threshold >= 0.90 ? 'Strict (90%+)' : threshold >= 0.80 ? 'Recommended (80%+)' : threshold >= 0.75 ? 'Loose (75%+)' : 'Very loose (catches more, more false positives)';

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-gray-950">
      {/* Detection controls */}
      <div className="card p-5 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">AI Duplicate Detection</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Combines title similarity (Levenshtein + Jaccard), abstract similarity, DOI, PMID, year, and journal
            </p>
          </div>
          <button onClick={handleDetect} disabled={detecting} className="btn-primary flex-shrink-0">
            <SparklesIcon className="w-4 h-4" />
            {detecting ? 'Detecting...' : 'Run Detection'}
          </button>
        </div>

        {/* Threshold slider */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Similarity Threshold
            </label>
            <span className="text-lg font-bold text-brand-600 dark:text-brand-400">{Math.round(threshold * 100)}%</span>
          </div>
          <input
            type="range" min={0.60} max={0.99} step={0.01} value={threshold}
            onChange={e => setThreshold(parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full appearance-none cursor-pointer accent-brand-600"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>60% (more matches)</span>
            <span className="text-brand-600 dark:text-brand-400 font-medium">{thresholdLabel}</span>
            <span>99% (fewer matches)</span>
          </div>
          <div className="mt-3 flex gap-2">
            {[
              { label: 'Strict (90%)', value: 0.90 },
              { label: 'Recommended (80%)', value: 0.80 },
              { label: 'Loose (70%)', value: 0.70 },
            ].map(p => (
              <button key={p.value} onClick={() => setThreshold(p.value)}
                className={`text-xs px-3 py-1 rounded-lg border transition-colors ${
                  Math.abs(threshold - p.value) < 0.005
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-brand-400'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="card p-16 text-center">
          <DocumentDuplicateIcon className="w-16 h-16 text-gray-300 dark:text-gray-700 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">No duplicate groups found</h3>
          <p className="text-gray-400 mb-4">Run AI detection to find potential duplicates</p>
          <div className="max-w-lg mx-auto text-left bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-100 dark:border-blue-800">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">Matching criteria:</p>
            <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-1 list-disc list-inside">
              <li>Exact DOI / PMID match → 100%</li>
              <li>Title similarity (Levenshtein + Jaccard word sets) → 70% weight</li>
              <li>Abstract similarity (Jaccard) → 30% weight</li>
              <li>Year + journal agreement boosts score</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-xl p-3 text-amber-700 dark:text-amber-400">
            <span>⚠️</span>
            <span>{groups.length} group{groups.length !== 1 ? 's' : ''} — review each group and select which article to keep, or keep both if they're genuinely different</span>
          </div>

          {groups.map((group: any) => (
            <div key={group.duplicate_group_id} className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <DocumentDuplicateIcon className="w-5 h-5 text-orange-500" />
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{group.articles.length} potential duplicates</span>
                </div>
                <button onClick={() => keepBoth(group.duplicate_group_id, group.articles)}
                  className="btn-secondary text-xs py-1.5">
                  Keep Both
                </button>
              </div>

              <div className="space-y-3">
                {group.articles.map((article: any, i: number) => (
                  <div key={article.id}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      article.is_duplicate_primary
                        ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/10'
                        : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800'
                    }`}>
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        article.is_duplicate_primary ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700'
                      }`}>
                        {article.is_duplicate_primary && <CheckIcon className="w-3 h-3 text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{article.title}</p>
                        <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {article.authors && <span>{article.authors.split(';')[0].trim()}{article.authors.split(';').length > 1 ? ' et al.' : ''}</span>}
                          {article.journal && <span>{article.journal}</span>}
                          {article.year && <span>{article.year}</span>}
                          {article.doi && <span className="font-mono">DOI: {article.doi}</span>}
                          {article.pmid && <span className="font-mono">PMID: {article.pmid}</span>}
                        </div>
                        {article.abstract && (
                          <div className="mt-2">
                            <button onClick={() => {
                              const s = new Set(expandedAbstracts);
                              s.has(article.id) ? s.delete(article.id) : s.add(article.id);
                              setExpandedAbstracts(s);
                            }} className="text-xs text-brand-600 dark:text-brand-400 hover:underline">
                              {expandedAbstracts.has(article.id) ? 'Hide abstract' : 'Show abstract'}
                            </button>
                            {expandedAbstracts.has(article.id) && (
                              <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 line-clamp-4">{article.abstract}</p>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex-shrink-0">
                        {article.is_duplicate_primary ? (
                          <span className="badge bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">✓ Primary</span>
                        ) : (
                          <button onClick={() => setPrimary(article.id, group.duplicate_group_id, group.articles)}
                            className="btn-secondary text-xs py-1 px-2">
                            Set Primary
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
