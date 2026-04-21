import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from 'react-query';
import { useState, useRef } from 'react';
import toast from 'react-hot-toast';
import { articlesApi } from '../../api/client';
import ScreeningInterface from '../../components/screening/ScreeningInterface';
import { SparklesIcon, ArrowDownTrayIcon, ArrowUpTrayIcon, MagnifyingGlassIcon, XMarkIcon, TrashIcon } from '@heroicons/react/24/outline';

// Which abstract-screened articles are eligible for full-text
type InclusionFilter = 'include' | 'include,maybe' | 'include,maybe,exclude';

const FILTER_OPTIONS: { value: InclusionFilter; label: string; desc: string }[] = [
  { value: 'include', label: 'Included only', desc: 'Articles marked Include at abstract screening' },
  { value: 'include,maybe', label: 'Included + Maybe', desc: 'Include and Maybe decisions from abstract' },
  { value: 'include,maybe,exclude', label: 'All screened', desc: 'Every article screened at abstract stage' },
];

function PdfViewer({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex flex-col">
      <div className="bg-white dark:bg-gray-900 flex items-center justify-between px-4 py-2 flex-shrink-0 border-b border-gray-200 dark:border-gray-700">
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate max-w-2xl">{title}</p>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <a href={url} download className="btn-secondary text-xs py-1 px-2">
            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> Download
          </a>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
            <XMarkIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>
      </div>
      <iframe src={url} className="flex-1 w-full bg-gray-100" title={title} />
    </div>
  );
}

function FullTextManager({ reviewId, inclusionFilter }: { reviewId: string; inclusionFilter: InclusionFilter }) {
  const qc = useQueryClient();
  const [fetching, setFetching] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [batchFetching, setBatchFetching] = useState(false);
  const [viewingPdf, setViewingPdf] = useState<{ url: string; title: string } | null>(null);

  const { data: articlesData, refetch } = useQuery(
    ['abstract-included', reviewId, inclusionFilter],
    () => articlesApi.list(reviewId, {
      phase: 'abstract',
      require_abstract: inclusionFilter,
      limit: 500,
    }).then(r => r.data),
    { enabled: !!reviewId }
  );

  const articles = articlesData?.articles || [];
  const withPdf = articles.filter((a: any) => a.full_text_url).length;
  const withoutPdf = articles.length - withPdf;

  const handleFetch = async (articleId: string) => {
    setFetching(articleId);
    try {
      const { data } = await articlesApi.fetchFullText(reviewId, articleId);
      if (data.found) {
        toast.success(`✓ Found via ${data.source}`);
      } else {
        toast(`⚠️ ${data.message}`, { icon: '📄' });
      }
      refetch();
      qc.invalidateQueries(['articles', reviewId]);
    } catch (err: any) {
      toast.error('Fetch failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setFetching(null);
    }
  };

  const handleBatchFetch = async () => {
    const missing = articles.filter((a: any) => !a.full_text_url);
    if (!missing.length) return toast('All articles already have full texts');
    setBatchFetching(true);
    // Fetch in parallel batches of 3
    let found = 0;
    for (let i = 0; i < missing.length; i += 3) {
      const batch = missing.slice(i, i + 3);
      const results = await Promise.allSettled(
        batch.map((a: any) => articlesApi.fetchFullText(reviewId, a.id).then(r => r.data))
      );
      found += results.filter(r => r.status === 'fulfilled' && (r.value as any).found).length;
    }
    toast.success(`Batch complete: ${found}/${missing.length} retrieved`);
    refetch();
    qc.invalidateQueries(['articles', reviewId]);
    setBatchFetching(false);
  };

  const handleDelete = async (articleId: string) => {
    if (!confirm('Remove the full text for this article? This will delete the stored PDF.')) return;
    setDeleting(articleId);
    try {
      await articlesApi.deleteFullText(reviewId, articleId);
      toast.success('Full text removed');
      refetch();
      qc.invalidateQueries(['articles', reviewId]);
    } catch { toast.error('Failed to remove full text'); }
    finally { setDeleting(null); }
  };

  const handleUpload = async (articleId: string, file: File) => {
    setUploading(articleId);
    try {
      await articlesApi.uploadPdf(reviewId, articleId, file);
      toast.success('PDF uploaded!');
      refetch();
      qc.invalidateQueries(['articles', reviewId]);
    } catch { toast.error('Upload failed'); }
    finally { setUploading(null); }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-gray-950">
      {viewingPdf && <PdfViewer url={viewingPdf.url} title={viewingPdf.title} onClose={() => setViewingPdf(null)} />}

      {/* Header */}
      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Full-Text Management</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Auto-retrieve PDFs from Unpaywall, PMC, Semantic Scholar, arXiv, CORE, Sci-Hub, Anna's Archive
            </p>
          </div>
          <button onClick={handleBatchFetch} disabled={batchFetching || !withoutPdf}
            className="btn-primary">
            <SparklesIcon className="w-4 h-4" />
            {batchFetching ? 'Fetching...' : `Auto-Fetch All (${withoutPdf} missing)`}
          </button>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600 dark:text-gray-400">Full texts retrieved</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{withPdf} / {articles.length}</span>
            </div>
            <div className="h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div className="h-2.5 bg-emerald-500 rounded-full transition-all" style={{ width: articles.length > 0 ? `${withPdf / articles.length * 100}%` : '0%' }} />
            </div>
          </div>
          <div className="flex gap-3 text-sm">
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <span className="w-2 h-2 bg-emerald-500 rounded-full" />{withPdf} retrieved
            </span>
            <span className="flex items-center gap-1 text-gray-400">
              <span className="w-2 h-2 bg-gray-300 dark:bg-gray-600 rounded-full" />{withoutPdf} missing
            </span>
          </div>
        </div>

        <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
          <p className="text-xs text-blue-700 dark:text-blue-400">
            <strong>Sources tried in parallel:</strong> Unpaywall, Europe PMC/PMC, Semantic Scholar, arXiv, bioRxiv/medRxiv, CORE, Sci-Hub (3 mirrors), Anna's Archive.
            All PDFs verified and stored locally. Click <strong>View</strong> to read inline.
          </p>
        </div>
      </div>

      {/* Articles */}
      <div className="space-y-2">
        {articles.map((article: any) => (
          <div key={article.id} className="card p-4">
            <div className="flex items-start gap-3">
              <div className={`mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 ${article.full_text_url ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{article.title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {article.authors?.split(';')[0]?.trim()} · {article.journal} · {article.year}
                  {article.doi && <span className="ml-2 font-mono">DOI: {article.doi}</span>}
                  <span className={`ml-2 font-medium ${
                    article.my_decision === 'include' ? 'text-emerald-600' :
                    article.my_decision === 'maybe' ? 'text-amber-600' : 'text-gray-400'
                  }`}>({article.my_decision || 'unscreened'})</span>
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {article.full_text_url ? (
                  <>
                    <button onClick={() => setViewingPdf({ url: article.full_text_url, title: article.title })}
                      className="btn-secondary text-xs py-1 px-2">
                      📄 View
                    </button>
                    <a href={article.full_text_url} download
                      className="btn-secondary text-xs py-1 px-2">
                      <ArrowDownTrayIcon className="w-3.5 h-3.5" />
                    </a>
                    <button onClick={() => handleFetch(article.id)} disabled={!!fetching || batchFetching}
                      className="btn-secondary text-xs py-1 px-2 text-gray-400" title="Re-fetch">
                      {fetching === article.id ? '...' : '↺'}
                    </button>
                    <button
                      onClick={() => handleDelete(article.id)}
                      disabled={deleting === article.id}
                      title="Remove full text"
                      className="btn-secondary text-xs py-1 px-2 text-red-400 hover:text-red-600 hover:border-red-300">
                      {deleting === article.id
                        ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                        : <TrashIcon className="w-3.5 h-3.5" />}
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => handleFetch(article.id)} disabled={!!fetching || batchFetching}
                      className="btn-secondary text-xs py-1 px-2">
                      {fetching === article.id ? (
                        <><svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> Searching...</>
                      ) : (
                        <><MagnifyingGlassIcon className="w-3.5 h-3.5" /> Auto-Fetch</>
                      )}
                    </button>
                    <label className={`btn-secondary text-xs py-1 px-2 cursor-pointer ${uploading === article.id ? 'opacity-60 pointer-events-none' : ''}`}>
                      <ArrowUpTrayIcon className="w-3.5 h-3.5" />
                      {uploading === article.id ? 'Uploading...' : 'Upload PDF'}
                      <input type="file" accept=".pdf" className="hidden"
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(article.id, f); }} />
                    </label>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {articles.length === 0 && (
          <div className="card p-12 text-center">
            <p className="text-gray-400">No articles match the current inclusion filter</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FulltextScreening() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const [tab, setTab] = useState<'manage' | 'screen'>('manage');
  const [inclusionFilter, setInclusionFilter] = useState<InclusionFilter>('include');

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tab bar + inclusion filter */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 flex items-center justify-between">
        <div className="flex gap-4">
          {[
            { id: 'manage', label: '📄 Full-Text Management' },
            { id: 'screen', label: '🔍 Screen Articles' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-brand-600 text-brand-700 dark:text-brand-300'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Inclusion filter selector */}
        <div className="flex items-center gap-2 py-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Show articles:</span>
          <div className="flex gap-1">
            {FILTER_OPTIONS.map(opt => (
              <button key={opt.value} onClick={() => setInclusionFilter(opt.value)}
                title={opt.desc}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium ${
                  inclusionFilter === opt.value
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-brand-400'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'manage'
        ? <FullTextManager reviewId={reviewId!} inclusionFilter={inclusionFilter} />
        : <ScreeningInterface reviewId={reviewId!} phase="fulltext" requireAbstract={inclusionFilter} />
      }
    </div>
  );
}
