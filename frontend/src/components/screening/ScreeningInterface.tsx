import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import toast from 'react-hot-toast';
import { articlesApi, screeningApi } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import DecisionBadge from '../common/DecisionBadge';
import ProgressBar from '../common/ProgressBar';
import {
  ChevronLeftIcon, ChevronRightIcon, CheckIcon, XMarkIcon, QuestionMarkCircleIcon,
  MagnifyingGlassIcon, FunnelIcon, TagIcon, SparklesIcon,
  CheckCircleIcon as CheckCircleOutline
} from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

const EXCLUDE_REASONS = [
  'Wrong population', 'Wrong intervention', 'Wrong comparator', 'Wrong outcome',
  'Wrong study design', 'Wrong publication type', 'Duplicate', 'Not relevant', 'Other'
];

const STUDY_TYPE_FILTERS = [
  { label: 'Case Report', keywords: ['case report', 'case series'] },
  { label: 'Review / SR / MA', keywords: ['systematic review', 'meta-analysis', 'literature review', 'scoping review'] },
  { label: 'Retrospective', keywords: ['retrospective'] },
  { label: 'Animal Study', keywords: ['animal', 'mice', 'rat ', 'murine', 'rodent', 'in vivo', 'in vitro'] },
  { label: 'Editorial / Letter', keywords: ['editorial', 'letter to the editor', 'commentary'] },
  { label: 'Conference Abstract', keywords: ['conference', 'proceedings', 'congress'] },
  { label: 'Guideline', keywords: ['guideline', 'consensus statement', 'recommendation'] },
];

function highlightText(text: string, keywords: string[]): React.ReactNode {
  if (!text || !keywords.length) return text;
  const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} className="keyword-highlight">{part}</mark>
      : part
  );
}

interface ScreeningInterfaceProps {
  reviewId: string;
  phase: 'abstract' | 'fulltext';
  requireAbstract?: string; // e.g. 'include' or 'include,maybe'
}

export default function ScreeningInterface({ reviewId, phase, requireAbstract }: ScreeningInterfaceProps) {
  const user = useAuthStore(s => s.user);
  const qc = useQueryClient();

  // Filter state
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [keywordHighlight, setKeywordHighlight] = useState('');
  const [activeStudyTypeFilters, setActiveStudyTypeFilters] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [customFilter, setCustomFilter] = useState('');

  // UI state
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [selectedReason, setSelectedReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const screenStartTime = useRef(Date.now());

  // Compute active highlight keywords
  const highlightKeywords: string[] = [
    ...(keywordHighlight ? keywordHighlight.split(',').map(k => k.trim()).filter(Boolean) : []),
    ...(customFilter ? [customFilter] : []),
    ...activeStudyTypeFilters.flatMap(label =>
      STUDY_TYPE_FILTERS.find(f => f.label === label)?.keywords || []
    ),
  ];

  const { data: articlesData, refetch } = useQuery(
    ['articles', reviewId, phase, filter, search, requireAbstract],
    () => articlesApi.list(reviewId, {
      phase,
      decision: filter === 'all' ? undefined : filter,
      search: search || undefined,
      require_abstract: requireAbstract || undefined,
      limit: 500,
    }).then(r => r.data),
    { enabled: !!reviewId, keepPreviousData: true }
  );

  const { data: progress, refetch: refetchProgress } = useQuery(
    ['progress', reviewId],
    () => screeningApi.progress(reviewId).then(r => r.data),
    { enabled: !!reviewId }
  );

  const allArticles = articlesData?.articles || [];

  // Apply client-side study type + custom filters
  const articles = allArticles.filter((a: any) => {
    if (!activeStudyTypeFilters.length && !customFilter) return true;
    const text = ((a.title || '') + ' ' + (a.abstract || '')).toLowerCase();
    if (customFilter && text.includes(customFilter.toLowerCase())) return true;
    for (const label of activeStudyTypeFilters) {
      const kws = STUDY_TYPE_FILTERS.find(f => f.label === label)?.keywords || [];
      if (kws.some(k => text.includes(k.toLowerCase()))) return true;
    }
    return false;
  });

  const total = articles.length;
  const current = articles[currentIndex];

  const decideMutation = useMutation(
    (data: any) => screeningApi.decide(reviewId, data),
    {
      onSuccess: (res) => {
        qc.invalidateQueries(['articles', reviewId]);
        refetchProgress();
        if (res.data.has_conflict) toast('⚠️ Conflict detected', { icon: '⚠️', style: { background: '#FEF3C7' } });
      },
      onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save decision')
    }
  );

  const decide = useCallback((decision: 'include' | 'exclude' | 'maybe', reason?: string) => {
    if (!current) return;
    const timeSpent = Math.round((Date.now() - screenStartTime.current) / 1000);
    screenStartTime.current = Date.now();
    decideMutation.mutate({ article_id: current.id, phase, decision, reason: reason || '', time_spent: timeSpent });
    if (currentIndex < articles.length - 1) setCurrentIndex(i => i + 1);
    toast.success(decision === 'include' ? '✓ Included' : decision === 'exclude' ? '✗ Excluded' : '? Maybe', {
      duration: 800, style: { fontSize: '13px' }
    });
  }, [current, currentIndex, articles.length, phase, decideMutation]);

  // Bulk decision
  const bulkDecide = async (decision: 'include' | 'exclude' | 'maybe', reason?: string) => {
    const ids = Array.from(selectedIds);
    let count = 0;
    for (const id of ids) {
      try {
        await screeningApi.decide(reviewId, { article_id: id, phase, decision, reason: reason || 'Bulk action' });
        count++;
      } catch {}
    }
    toast.success(`${decision === 'include' ? '✓ Included' : '✗ Excluded'} ${count} articles`);
    setSelectedIds(new Set());
    setBulkMode(false);
    qc.invalidateQueries(['articles', reviewId]);
    refetchProgress();
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (bulkMode) return;
      if (e.key === 'i' || e.key === 'I') decide('include');
      if (e.key === 'e' || e.key === 'E') { if (phase === 'fulltext') setShowReasonModal(true); else decide('exclude'); }
      if (e.key === 'm' || e.key === 'M') decide('maybe');
      if (e.key === 'ArrowRight') setCurrentIndex(i => Math.min(i + 1, articles.length - 1));
      if (e.key === 'ArrowLeft') setCurrentIndex(i => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [decide, articles.length, bulkMode]);

  const handleExclude = () => {
    const reason = selectedReason === 'Other' ? customReason : selectedReason;
    decide('exclude', reason);
    setShowReasonModal(false);
    setSelectedReason('');
    setCustomReason('');
  };

  const screened = phase === 'abstract' ? progress?.my_abstract_screened : progress?.my_fulltext_screened;
  const totalForPhase = progress?.total_articles || 0;

  const toggleSelectAll = () => {
    if (selectedIds.size === articles.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(articles.map((a: any) => a.id)));
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Header bar */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-3 flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">
              {phase === 'abstract' ? 'Abstract Screening' : 'Full-Text Screening'}
            </h2>
            <span className="badge bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">{total} articles</span>
            {activeStudyTypeFilters.length > 0 || customFilter ? (
              <span className="badge bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300">
                {activeStudyTypeFilters.length + (customFilter ? 1 : 0)} filter{activeStudyTypeFilters.length + (customFilter ? 1 : 0) !== 1 ? 's' : ''} active
              </span>
            ) : null}
          </div>
          <ProgressBar value={screened || 0} max={totalForPhase || 1} showLabel={false} size="sm" />
        </div>
        <div className="text-sm text-right">
          <p className="font-medium text-gray-900 dark:text-gray-100">{screened || 0} / {totalForPhase}</p>
          <p className="text-gray-400 text-xs">screened</p>
        </div>
        <button onClick={() => setBulkMode(b => !b)}
          className={`btn-secondary text-xs py-1.5 ${bulkMode ? 'border-brand-400 text-brand-600 dark:text-brand-400' : ''}`}>
          {bulkMode ? '✓ Bulk Mode ON' : 'Bulk Select'}
        </button>
        <button onClick={() => setShowFilters(s => !s)} className={`btn-secondary text-xs py-1.5 ${showFilters ? 'border-brand-400' : ''}`}>
          <FunnelIcon className="w-4 h-4" /> Filters
        </button>
        <button onClick={() => setShowShortcuts(s => !s)} className="btn-secondary text-xs py-1.5">⌨️</button>
      </div>

      {showShortcuts && (
        <div className="bg-brand-50 dark:bg-brand-900/20 border-b border-brand-100 dark:border-brand-800 px-6 py-2 flex gap-6 text-xs text-brand-700 dark:text-brand-300">
          <span><kbd className="bg-white dark:bg-gray-800 border border-brand-200 dark:border-brand-700 rounded px-1.5 py-0.5 font-mono mr-1">I</kbd>Include</span>
          <span><kbd className="bg-white dark:bg-gray-800 border border-brand-200 dark:border-brand-700 rounded px-1.5 py-0.5 font-mono mr-1">E</kbd>Exclude</span>
          <span><kbd className="bg-white dark:bg-gray-800 border border-brand-200 dark:border-brand-700 rounded px-1.5 py-0.5 font-mono mr-1">M</kbd>Maybe</span>
          <span><kbd className="bg-white dark:bg-gray-800 border border-brand-200 dark:border-brand-700 rounded px-1.5 py-0.5 font-mono mr-1">← →</kbd>Navigate</span>
        </div>
      )}

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label text-xs">Highlight Keywords (comma-separated)</label>
              <input className="input text-sm" placeholder="e.g. diabetes, insulin, RCT"
                value={keywordHighlight} onChange={e => setKeywordHighlight(e.target.value)} />
            </div>
            <div>
              <label className="label text-xs">Custom Filter / Exclude Term</label>
              <input className="input text-sm" placeholder="e.g. pediatric, case report"
                value={customFilter} onChange={e => setCustomFilter(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label text-xs mb-2">Quick Study-Type Filters (shows articles matching ANY selected)</label>
            <div className="flex flex-wrap gap-2">
              {STUDY_TYPE_FILTERS.map(f => (
                <button key={f.label} onClick={() => {
                  setActiveStudyTypeFilters(prev =>
                    prev.includes(f.label) ? prev.filter(x => x !== f.label) : [...prev, f.label]
                  );
                  setCurrentIndex(0);
                }}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                    activeStudyTypeFilters.includes(f.label)
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-brand-400'
                  }`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {bulkMode && selectedIds.size > 0 && (
            <div className="flex items-center gap-3 bg-brand-50 dark:bg-brand-900/20 rounded-xl p-3 border border-brand-200 dark:border-brand-800">
              <span className="text-sm font-medium text-brand-700 dark:text-brand-300">{selectedIds.size} selected</span>
              <button onClick={() => bulkDecide('include')} className="btn-primary text-xs py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700">
                <CheckIcon className="w-3.5 h-3.5" /> Bulk Include
              </button>
              <button onClick={() => bulkDecide('exclude', 'Bulk excluded')} className="btn-danger text-xs py-1.5 px-3">
                <XMarkIcon className="w-3.5 h-3.5" /> Bulk Exclude
              </button>
              <button onClick={() => bulkDecide('maybe')} className="btn-secondary text-xs py-1.5 px-3 text-amber-600 dark:text-amber-400">
                <QuestionMarkCircleIcon className="w-3.5 h-3.5" /> Bulk Maybe
              </button>
              <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-gray-600 ml-auto">Clear</button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Article list */}
        <div className="w-72 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col">
          <div className="p-3 border-b border-gray-100 dark:border-gray-800 space-y-2">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input className="input pl-8 py-1.5 text-xs" placeholder="Search articles..."
                value={search} onChange={e => { setSearch(e.target.value); setCurrentIndex(0); }} />
            </div>
            <div className="flex gap-1 flex-wrap">
              {(['all', 'unscreened', 'include', 'exclude', 'maybe'] as const).map(f => (
                <button key={f} onClick={() => { setFilter(f); setCurrentIndex(0); }}
                  className={`text-xs px-2 py-1 rounded-md font-medium transition-colors ${
                    filter === f
                      ? 'bg-brand-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            {bulkMode && (
              <button onClick={toggleSelectAll} className="text-xs text-brand-600 dark:text-brand-400 hover:underline w-full text-left">
                {selectedIds.size === articles.length ? 'Deselect all' : `Select all ${articles.length}`}
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {articles.map((article: any, i: number) => (
              <button key={article.id}
                onClick={() => { if (bulkMode) { const s = new Set(selectedIds); s.has(article.id) ? s.delete(article.id) : s.add(article.id); setSelectedIds(s); } else setCurrentIndex(i); }}
                className={`w-full text-left p-3 border-b border-gray-50 dark:border-gray-800 transition-colors ${
                  bulkMode && selectedIds.has(article.id)
                    ? 'bg-brand-50 dark:bg-brand-900/20'
                    : i === currentIndex && !bulkMode
                      ? 'bg-brand-50 dark:bg-brand-900/20 border-l-2 border-l-brand-600'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}>
                <div className="flex items-start gap-2">
                  {bulkMode && (
                    <div className={`mt-0.5 w-4 h-4 rounded border-2 flex-shrink-0 ${selectedIds.has(article.id) ? 'bg-brand-600 border-brand-600' : 'border-gray-300 dark:border-gray-600'}`}>
                      {selectedIds.has(article.id) && <CheckIcon className="w-3 h-3 text-white" />}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900 dark:text-gray-100 line-clamp-2 mb-1">
                      {highlightKeywords.length > 0 ? highlightText(article.title, highlightKeywords) : article.title}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">{article.year}</span>
                      <DecisionBadge decision={article.my_decision} size="sm" />
                    </div>
                  </div>
                </div>
              </button>
            ))}
            {articles.length === 0 && (
              <div className="p-6 text-center text-sm text-gray-400">
                {filter === 'unscreened' ? '🎉 All caught up!' : 'No articles found'}
              </div>
            )}
          </div>
        </div>

        {/* Article detail */}
        <div className="flex-1 overflow-y-auto p-6">
          {current ? (
            <div className="max-w-3xl mx-auto">
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => setCurrentIndex(i => Math.max(0, i - 1))} disabled={currentIndex === 0}
                  className="btn-secondary text-sm py-1.5 disabled:opacity-30">
                  <ChevronLeftIcon className="w-4 h-4" />Prev
                </button>
                <span className="text-sm text-gray-500 dark:text-gray-400">{currentIndex + 1} of {articles.length}</span>
                <button onClick={() => setCurrentIndex(i => Math.min(articles.length - 1, i + 1))} disabled={currentIndex >= articles.length - 1}
                  className="btn-secondary text-sm py-1.5 disabled:opacity-30">
                  Next<ChevronRightIcon className="w-4 h-4" />
                </button>
              </div>

              <div className="card p-6 mb-4">
                <div className="flex items-start justify-between mb-3">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 leading-snug flex-1 mr-4">
                    {highlightKeywords.length > 0 ? highlightText(current.title, highlightKeywords) : current.title}
                  </h2>
                  <DecisionBadge decision={current.my_decision} />
                </div>
                <div className="flex flex-wrap gap-3 text-sm text-gray-500 dark:text-gray-400 mb-4">
                  {current.authors && <span>👤 {current.authors.split(';').slice(0, 3).join('; ')}{current.authors.split(';').length > 3 ? ' et al.' : ''}</span>}
                  {current.journal && <span>📚 {current.journal}</span>}
                  {current.year && <span>📅 {current.year}</span>}
                  {current.doi && <a href={`https://doi.org/${current.doi}`} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">DOI</a>}
                  {current.pmid && <a href={`https://pubmed.ncbi.nlm.nih.gov/${current.pmid}`} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">PubMed</a>}
                </div>
                {current.abstract ? (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Abstract</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                      {highlightKeywords.length > 0 ? highlightText(current.abstract, highlightKeywords) : current.abstract}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No abstract available</p>
                )}
                {phase === 'fulltext' && current.full_text_url && (
                  <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 flex gap-3">
                    <a href={current.full_text_url} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm py-1.5 inline-flex">
                      📄 View Full Text
                    </a>
                    <a href={current.full_text_url} download className="btn-secondary text-sm py-1.5 inline-flex">
                      ⬇️ Download PDF
                    </a>
                  </div>
                )}
              </div>

              {/* Others' decisions (unblinded) */}
              {Array.isArray(current.others_decisions) && current.others_decisions.length > 0 && (
                <div className="card p-4 mb-4 border-violet-100 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20">
                  <p className="text-xs font-semibold text-violet-700 dark:text-violet-300 uppercase tracking-wider mb-2">Other Reviewers</p>
                  <div className="flex gap-3 flex-wrap">
                    {current.others_decisions.map((d: any, i: number) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-violet-600 dark:text-violet-400">{d.name}:</span>
                        <DecisionBadge decision={d.decision} size="sm" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Decision buttons */}
              <div className="flex gap-3 justify-center mt-4">
                {[
                  { decision: 'include' as const, icon: CheckIcon, label: 'Include', key: 'I', activeClass: 'border-emerald-500 bg-emerald-500 text-white shadow-lg shadow-emerald-100 dark:shadow-emerald-900', inactiveClass: 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-emerald-600 dark:text-emerald-400 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20', onClick: () => decide('include') },
                  { decision: 'maybe' as const, icon: QuestionMarkCircleIcon, label: 'Maybe', key: 'M', activeClass: 'border-amber-500 bg-amber-500 text-white shadow-lg shadow-amber-100 dark:shadow-amber-900', inactiveClass: 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-amber-600 dark:text-amber-400 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20', onClick: () => decide('maybe') },
                  { decision: 'exclude' as const, icon: XMarkIcon, label: 'Exclude', key: 'E', activeClass: 'border-red-500 bg-red-500 text-white shadow-lg shadow-red-100 dark:shadow-red-900', inactiveClass: 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-red-600 dark:text-red-400 hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/20', onClick: () => phase === 'fulltext' ? setShowReasonModal(true) : decide('exclude') },
                ].map(({ decision, icon: Icon, label, key, activeClass, inactiveClass, onClick }) => (
                  <button key={decision} onClick={onClick}
                    className={`flex-1 max-w-36 flex flex-col items-center gap-2 py-4 rounded-xl border-2 transition-all duration-150 font-semibold ${current.my_decision === decision ? activeClass : inactiveClass}`}>
                    <Icon className="w-7 h-7" />
                    <span>{label}</span>
                    <kbd className="text-xs opacity-60 font-mono bg-black/10 px-1.5 py-0.5 rounded">{key}</kbd>
                  </button>
                ))}
              </div>
              {current.my_reason && (
                <div className="mt-3 text-center text-sm text-gray-500 dark:text-gray-400">
                  Reason: <span className="font-medium text-gray-700 dark:text-gray-300">{current.my_reason}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <CheckCircleIcon className="w-16 h-16 text-emerald-300 mb-4" />
              <p className="text-lg font-medium text-gray-600 dark:text-gray-400">All caught up!</p>
              <p className="text-sm">No articles to screen in this view</p>
            </div>
          )}
        </div>
      </div>

      {/* Exclude reason modal */}
      {showReasonModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-gray-100 dark:border-gray-800">
              <h3 className="font-semibold dark:text-gray-100">Reason for Exclusion</h3>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-2 gap-2 mb-4">
                {EXCLUDE_REASONS.map(r => (
                  <button key={r} onClick={() => setSelectedReason(r)}
                    className={`text-sm py-2 px-3 rounded-lg border text-left transition-colors ${
                      selectedReason === r
                        ? 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 font-medium'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 text-gray-700 dark:text-gray-300'
                    }`}>
                    {r}
                  </button>
                ))}
              </div>
              {selectedReason === 'Other' && (
                <input className="input" placeholder="Specify reason..." value={customReason}
                  onChange={e => setCustomReason(e.target.value)} autoFocus />
              )}
            </div>
            <div className="p-5 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3">
              <button onClick={() => { setShowReasonModal(false); setSelectedReason(''); }} className="btn-secondary">Cancel</button>
              <button onClick={handleExclude} disabled={!selectedReason || (selectedReason === 'Other' && !customReason)} className="btn-danger">
                Confirm Exclude
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
