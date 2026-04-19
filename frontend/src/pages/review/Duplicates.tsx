import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { articlesApi } from '../../api/client';
import { SparklesIcon, CheckIcon, DocumentDuplicateIcon } from '@heroicons/react/24/outline';

export default function Duplicates() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const qc = useQueryClient();
  const [detecting, setDetecting] = useState(false);

  const { data: groups = [], refetch } = useQuery(
    ['duplicate-groups', reviewId],
    () => articlesApi.duplicateGroups(reviewId!).then(r => r.data),
    { enabled: !!reviewId }
  );

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const { data } = await articlesApi.detectDuplicates(reviewId!);
      toast.success(`Found ${data.duplicates_found} duplicates in ${data.groups} groups`);
      refetch();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Detection failed');
    } finally {
      setDetecting(false);
    }
  };

  const setPrimary = async (articleId: string, groupId: string, currentGroupArticles: any[]) => {
    try {
      // Set all in group as non-primary, then set this one as primary
      for (const a of currentGroupArticles) {
        await articlesApi.setDuplicate(reviewId!, a.id, {
          is_duplicate_primary: a.id === articleId ? 1 : 0,
          duplicate_group_id: groupId,
        });
      }
      toast.success('Primary article updated');
      refetch();
    } catch {
      toast.error('Failed to update');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Duplicate Detection</h2>
          <p className="text-sm text-gray-500 mt-1">AI-powered detection using title similarity, DOI, and PMID matching</p>
        </div>
        <button onClick={handleDetect} disabled={detecting} className="btn-primary">
          <SparklesIcon className="w-4 h-4" />
          {detecting ? 'Detecting...' : 'Run AI Detection'}
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="card p-16 text-center">
          <DocumentDuplicateIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">No duplicate groups found</h3>
          <p className="text-gray-400 mb-6">Run AI detection to automatically identify potential duplicates</p>
          <div className="max-w-lg mx-auto text-left bg-blue-50 rounded-xl p-4">
            <p className="text-sm font-medium text-blue-800 mb-2">How it works:</p>
            <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
              <li>Exact DOI and PMID matching</li>
              <li>Title similarity scoring (Levenshtein + Jaccard)</li>
              <li>Year and journal corroboration</li>
              <li>Groups articles with ≥85% similarity</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 bg-amber-50 border border-amber-100 rounded-xl p-3">
            <span>⚠️</span>
            <span>{groups.length} duplicate group{groups.length !== 1 ? 's' : ''} found — review each group and confirm which article to keep as primary</span>
          </div>

          {groups.map((group: any) => (
            <div key={group.duplicate_group_id} className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <DocumentDuplicateIcon className="w-5 h-5 text-orange-500" />
                <span className="font-semibold text-gray-900">{group.articles.length} duplicate articles</span>
                <span className="badge bg-orange-50 text-orange-700">Group</span>
              </div>
              <div className="space-y-3">
                {group.articles.map((article: any) => (
                  <div key={article.id}
                    className={`flex items-start gap-4 p-4 rounded-xl border-2 transition-all ${
                      article.is_duplicate_primary
                        ? 'border-emerald-400 bg-emerald-50'
                        : 'border-gray-200 bg-gray-50'
                    }`}>
                    <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      article.is_duplicate_primary ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300 bg-white'
                    }`}>
                      {article.is_duplicate_primary && <CheckIcon className="w-3 h-3 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm">{article.title}</p>
                      <div className="flex gap-3 mt-1 text-xs text-gray-500">
                        {article.authors && <span>{article.authors.split(';')[0]}{article.authors.split(';').length > 1 ? ' et al.' : ''}</span>}
                        {article.journal && <span>{article.journal}</span>}
                        {article.year && <span>{article.year}</span>}
                        {article.doi && <span>DOI: {article.doi}</span>}
                        {article.pmid && <span>PMID: {article.pmid}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {article.is_duplicate_primary ? (
                        <span className="badge bg-emerald-100 text-emerald-700">✓ Primary</span>
                      ) : (
                        <button
                          onClick={() => setPrimary(article.id, group.duplicate_group_id, group.articles)}
                          className="text-xs btn-secondary py-1 px-2">
                          Set as Primary
                        </button>
                      )}
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
