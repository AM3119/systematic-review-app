import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import toast from 'react-hot-toast';
import { articlesApi, screeningApi } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import DecisionBadge from '../common/DecisionBadge';
import ProgressBar from '../common/ProgressBar';
import Avatar from '../common/Avatar';
import {
  ChevronLeftIcon, ChevronRightIcon, CheckIcon, XMarkIcon, QuestionMarkCircleIcon,
  MagnifyingGlassIcon, FunnelIcon, TagIcon, ClockIcon, KeyboardIcon
} from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

const EXCLUDE_REASONS = [
  'Wrong population', 'Wrong intervention', 'Wrong outcome', 'Wrong study design',
  'Wrong publication type', 'Duplicate', 'Not relevant', 'Other'
];

interface ScreeningInterfaceProps {
  reviewId: string;
  phase: 'abstract' | 'fulltext';
}

export default function ScreeningInterface({ reviewId, phase }: ScreeningInterfaceProps) {
  const user = useAuthStore(s => s.user);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'unscreened' | 'include' | 'exclude' | 'maybe'>('all');
  const [search, setSearch] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showReasonModal, setShowReasonModal] = useState<'exclude' | null>(null);
  const [customReason, setCustomReason] = useState('');
  const [selectedReason, setSelectedReason] = useState('');
  const [startTime] = useState(Date.now());
  const [showShortcuts, setShowShortcuts] = useState(false);

  const { data: articlesData, refetch } = useQuery(
    ['articles', reviewId, phase, filter, search],
    () => articlesApi.list(reviewId, { phase, decision: filter === 'all' ? undefined : filter, search: search || undefined, limit: 200 }).then(r => r.data),
    { enabled: !!reviewId, keepPreviousData: true }
  );

  const { data: progress, refetch: refetchProgress } = useQuery(
    ['progress', reviewId],
    () => screeningApi.progress(reviewId).then(r => r.data),
    { enabled: !!reviewId }
  );

  const articles = articlesData?.articles || [];
  const total = articlesData?.total || 0;
  const current = articles[currentIndex];

  const decideMutation = useMutation(
    (data: any) => screeningApi.decide(reviewId, data),
    {
      onSuccess: (res) => {
        qc.invalidateQueries(['articles', reviewId]);
        refetchProgress();
        if (res.data.has_conflict) {
          toast('⚠️ Conflict detected with another reviewer', { icon: '⚠️', style: { background: '#FEF3C7' } });
        }
      },
      onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save decision')
    }
  );

  const decide = useCallback((decision: 'include' | 'exclude' | 'maybe', reason?: string) => {
    if (!current) return;
    const timeSpent = Math.round((Date.now() - startTime) / 1000);
    decideMutation.mutate({
      article_id: current.id,
      phase,
      decision,
      reason: reason || '',
      time_spent: timeSpent,
    });
    // Auto advance
    if (currentIndex < articles.length - 1) {
      setCurrentIndex(i => i + 1);
    }
    toast.success(
      decision === 'include' ? '✓ Included' : decision === 'exclude' ? '✗ Excluded' : '? Maybe',
      { duration: 1000, style: { fontSize: '13px' } }
    );
  }, [current, currentIndex, articles.length, phase, startTime, decideMutation]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'i' || e.key === 'I') decide('include');
      if (e.key === 'e' || e.key === 'E') setShowReasonModal('exclude');
      if (e.key === 'm' || e.key === 'M') decide('maybe');
      if (e.key === 'ArrowRight') setCurrentIndex(i => Math.min(i + 1, articles.length - 1));
      if (e.key === 'ArrowLeft') setCurrentIndex(i => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [decide, articles.length]);

  const handleExclude = () => {
    const reason = selectedReason === 'Other' ? customReason : selectedReason;
    decide('exclude', reason);
    setShowReasonModal(null);
    setSelectedReason('');
    setCustomReason('');
  };

  const screened = phase === 'abstract' ? progress?.my_abstract_screened : progress?.my_fulltext_screened;
  const totalForPhase = phase === 'abstract' ? progress?.total_articles : (progress?.total_articles || 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h2 className="font-semibold text-gray-900">
              {phase === 'abstract' ? 'Abstract Screening' : 'Full-Text Screening'}
            </h2>
            <span className="badge bg-gray-100 text-gray-600">{total} articles</span>
          </div>
          <ProgressBar value={screened || 0} max={totalForPhase || 1} showLabel={false} size="sm" />
        </div>
        <div className="text-sm text-gray-500 text-right">
          <p className="font-medium text-gray-900">{screened || 0} / {totalForPhase || 0}</p>
          <p>screened</p>
        </div>
        <button onClick={() => setShowShortcuts(s => !s)} className="btn-secondary text-xs py-1.5">
          ⌨️ Shortcuts
        </button>
      </div>

      {showShortcuts && (
        <div className="bg-brand-50 border-b border-brand-100 px-6 py-2 flex gap-6 text-xs text-brand-700">
          <span><kbd className="bg-white border border-brand-200 rounded px-1.5 py-0.5 font-mono mr-1">I</kbd>Include</span>
          <span><kbd className="bg-white border border-brand-200 rounded px-1.5 py-0.5 font-mono mr-1">E</kbd>Exclude</span>
          <span><kbd className="bg-white border border-brand-200 rounded px-1.5 py-0.5 font-mono mr-1">M</kbd>Maybe</span>
          <span><kbd className="bg-white border border-brand-200 rounded px-1.5 py-0.5 font-mono mr-1">←→</kbd>Navigate</span>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Article list */}
        <div className="w-72 border-r border-gray-200 bg-white flex flex-col">
          <div className="p-3 border-b border-gray-100 space-y-2">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input className="input pl-8 py-1.5 text-xs" placeholder="Search articles..."
                value={search} onChange={e => { setSearch(e.target.value); setCurrentIndex(0); }} />
            </div>
            <div className="flex gap-1 flex-wrap">
              {(['all', 'unscreened', 'include', 'exclude', 'maybe'] as const).map(f => (
                <button key={f} onClick={() => { setFilter(f); setCurrentIndex(0); }}
                  className={`text-xs px-2 py-1 rounded-md font-medium transition-colors ${filter === f ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {articles.map((article: any, i: number) => (
              <button key={article.id} onClick={() => setCurrentIndex(i)}
                className={`w-full text-left p-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${i === currentIndex ? 'bg-brand-50 border-l-2 border-l-brand-600' : ''}`}>
                <p className="text-xs font-medium text-gray-900 line-clamp-2 mb-1">{article.title}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">{article.year}</span>
                  <DecisionBadge decision={article.my_decision} size="sm" />
                </div>
              </button>
            ))}
            {articles.length === 0 && (
              <div className="p-6 text-center text-sm text-gray-400">
                {filter === 'unscreened' ? 'All articles screened! 🎉' : 'No articles found'}
              </div>
            )}
          </div>
        </div>

        {/* Article detail */}
        <div className="flex-1 overflow-y-auto p-6">
          {current ? (
            <div className="max-w-3xl mx-auto">
              {/* Navigation */}
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => setCurrentIndex(i => Math.max(0, i - 1))} disabled={currentIndex === 0}
                  className="btn-secondary text-sm py-1.5 disabled:opacity-30">
                  <ChevronLeftIcon className="w-4 h-4" />Prev
                </button>
                <span className="text-sm text-gray-500">{currentIndex + 1} of {articles.length}</span>
                <button onClick={() => setCurrentIndex(i => Math.min(articles.length - 1, i + 1))} disabled={currentIndex >= articles.length - 1}
                  className="btn-secondary text-sm py-1.5 disabled:opacity-30">
                  Next<ChevronRightIcon className="w-4 h-4" />
                </button>
              </div>

              {/* Article card */}
              <div className="card p-6 mb-4">
                <div className="flex items-start justify-between mb-3">
                  <h2 className="text-lg font-semibold text-gray-900 leading-snug flex-1 mr-4">{current.title}</h2>
                  <DecisionBadge decision={current.my_decision} />
                </div>
                <div className="flex flex-wrap gap-3 text-sm text-gray-500 mb-4">
                  {current.authors && <span>👤 {current.authors.split(';').slice(0, 3).join('; ')}{current.authors.split(';').length > 3 ? ' et al.' : ''}</span>}
                  {current.journal && <span>📚 {current.journal}</span>}
                  {current.year && <span>📅 {current.year}</span>}
                  {current.doi && <a href={`https://doi.org/${current.doi}`} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">DOI: {current.doi}</a>}
                  {current.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${current.pmid}`} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">PMID: {current.pmid}</a>}
                </div>
                {current.abstract ? (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Abstract</p>
                    <p className="text-sm text-gray-700 leading-relaxed">{current.abstract}</p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No abstract available</p>
                )}

                {phase === 'fulltext' && current.full_text_url && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <a href={current.full_text_url} target="_blank" rel="noopener noreferrer"
                      className="btn-secondary text-sm py-1.5 inline-flex">
                      📄 View Full Text
                    </a>
                  </div>
                )}
              </div>

              {/* Other reviewers (if not blinded) */}
              {current.others_decisions && JSON.parse(current.others_decisions || '[]').length > 0 && (
                <div className="card p-4 mb-4 border-violet-100 bg-violet-50">
                  <p className="text-xs font-semibold text-violet-700 uppercase tracking-wider mb-2">Other Reviewers</p>
                  <div className="flex gap-3">
                    {JSON.parse(current.others_decisions).map((d: any, i: number) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-violet-600">{d.name}:</span>
                        <DecisionBadge decision={d.decision} size="sm" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Decision buttons */}
              <div className="flex gap-3 justify-center mt-4">
                <button onClick={() => decide('include')}
                  className={`flex-1 max-w-36 flex flex-col items-center gap-2 py-4 rounded-xl border-2 transition-all duration-150 font-semibold
                    ${current.my_decision === 'include'
                      ? 'border-emerald-500 bg-emerald-500 text-white shadow-lg shadow-emerald-100'
                      : 'border-gray-200 bg-white text-emerald-600 hover:border-emerald-400 hover:bg-emerald-50'}`}>
                  <CheckIcon className="w-7 h-7" />
                  <span>Include</span>
                  <kbd className="text-xs opacity-60 font-mono bg-black/10 px-1.5 py-0.5 rounded">I</kbd>
                </button>
                <button onClick={() => decide('maybe')}
                  className={`flex-1 max-w-36 flex flex-col items-center gap-2 py-4 rounded-xl border-2 transition-all duration-150 font-semibold
                    ${current.my_decision === 'maybe'
                      ? 'border-amber-500 bg-amber-500 text-white shadow-lg shadow-amber-100'
                      : 'border-gray-200 bg-white text-amber-600 hover:border-amber-400 hover:bg-amber-50'}`}>
                  <QuestionMarkCircleIcon className="w-7 h-7" />
                  <span>Maybe</span>
                  <kbd className="text-xs opacity-60 font-mono bg-black/10 px-1.5 py-0.5 rounded">M</kbd>
                </button>
                <button onClick={() => setShowReasonModal('exclude')}
                  className={`flex-1 max-w-36 flex flex-col items-center gap-2 py-4 rounded-xl border-2 transition-all duration-150 font-semibold
                    ${current.my_decision === 'exclude'
                      ? 'border-red-500 bg-red-500 text-white shadow-lg shadow-red-100'
                      : 'border-gray-200 bg-white text-red-600 hover:border-red-400 hover:bg-red-50'}`}>
                  <XMarkIcon className="w-7 h-7" />
                  <span>Exclude</span>
                  <kbd className="text-xs opacity-60 font-mono bg-black/10 px-1.5 py-0.5 rounded">E</kbd>
                </button>
              </div>

              {current.my_reason && (
                <div className="mt-3 text-center text-sm text-gray-500">
                  Reason: <span className="font-medium text-gray-700">{current.my_reason}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <CheckCircleIcon className="w-16 h-16 text-emerald-300 mb-4" />
              <p className="text-lg font-medium text-gray-600">All caught up!</p>
              <p className="text-sm">No articles to screen in this view</p>
            </div>
          )}
        </div>
      </div>

      {/* Exclude reason modal */}
      {showReasonModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Reason for Exclusion</h3>
              <p className="text-sm text-gray-500 mt-1">Select the primary reason for excluding this article</p>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-2 gap-2 mb-4">
                {EXCLUDE_REASONS.map(r => (
                  <button key={r} onClick={() => setSelectedReason(r)}
                    className={`text-sm py-2 px-3 rounded-lg border text-left transition-colors ${selectedReason === r ? 'border-red-500 bg-red-50 text-red-700 font-medium' : 'border-gray-200 hover:border-gray-300 text-gray-700'}`}>
                    {r}
                  </button>
                ))}
              </div>
              {selectedReason === 'Other' && (
                <input className="input" placeholder="Specify reason..." value={customReason}
                  onChange={e => setCustomReason(e.target.value)} />
              )}
            </div>
            <div className="p-5 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => { setShowReasonModal(null); setSelectedReason(''); }} className="btn-secondary">Cancel</button>
              <button onClick={handleExclude} disabled={!selectedReason || (selectedReason === 'Other' && !customReason)}
                className="btn-danger">
                Confirm Exclude
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
