import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from 'react-query';
import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { extractionApi } from '../../api/client';
import {
  PlusIcon, TrashIcon, SparklesIcon, ArrowDownTrayIcon,
  Cog6ToothIcon, XMarkIcon
} from '@heroicons/react/24/outline';

// ─── Field Editor Modal ───────────────────────────────────────────────────────

function FieldEditor({ reviewId, onClose }: { reviewId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    field_name: '', field_label: '', field_type: 'text',
    section: 'General', required: false, options: '', ai_description: ''
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.field_label) return toast.error('Label required');
    setSaving(true);
    try {
      await extractionApi.createField(reviewId, {
        ...form,
        options: form.options ? form.options.split(',').map((o: string) => o.trim()) : []
      });
      qc.invalidateQueries(['extraction-summary', reviewId]);
      onClose();
      toast.success('Field added');
    } catch { toast.error('Failed to add field'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
          <h3 className="font-semibold dark:text-gray-100">Add Extraction Field</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><XMarkIcon className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label">Field Label *</label>
            <input className="input" placeholder="e.g. Sample Size" value={form.field_label}
              onChange={e => setForm(f => ({
                ...f,
                field_label: e.target.value,
                field_name: e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
              }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.field_type} onChange={e => setForm(f => ({ ...f, field_type: e.target.value }))}>
                {['text', 'textarea', 'number', 'select', 'date', 'boolean'].map(t => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Section</label>
              <input className="input" placeholder="General" value={form.section}
                onChange={e => setForm(f => ({ ...f, section: e.target.value }))} />
            </div>
          </div>
          {['select'].includes(form.field_type) && (
            <div>
              <label className="label">Options (comma-separated)</label>
              <input className="input" placeholder="RCT, Cohort, Case-Control" value={form.options}
                onChange={e => setForm(f => ({ ...f, options: e.target.value }))} />
            </div>
          )}
          <div>
            <label className="label">AI Extraction Hint</label>
            <input className="input" placeholder="e.g. The total number of participants enrolled"
              value={form.ai_description} onChange={e => setForm(f => ({ ...f, ai_description: e.target.value }))} />
            <p className="text-xs text-gray-400 mt-1">Guides the AI when auto-extracting this field from the full text</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.required}
              onChange={e => setForm(f => ({ ...f, required: e.target.checked }))} className="rounded" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Required field</span>
          </label>
        </div>
        <div className="p-5 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSubmit} disabled={saving} className="btn-primary">
            {saving ? 'Adding...' : 'Add Field'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Field Manager Modal ──────────────────────────────────────────────────────

function FieldManager({ reviewId, fields, onClose }: { reviewId: string; fields: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const handleDelete = async (fieldId: string, label: string) => {
    if (!confirm(`Delete field "${label}"? All extracted data for this field will also be deleted.`)) return;
    try {
      await extractionApi.deleteField(reviewId, fieldId);
      qc.invalidateQueries(['extraction-summary', reviewId]);
      toast.success('Field deleted');
    } catch { toast.error('Failed to delete field'); }
  };

  if (showAdd) return <FieldEditor reviewId={reviewId} onClose={() => setShowAdd(false)} />;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-semibold dark:text-gray-100">Manage Extraction Fields</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowAdd(true)} className="btn-primary text-sm py-1.5 px-3">
              <PlusIcon className="w-4 h-4" /> Add Field
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="p-5 max-h-96 overflow-y-auto">
          {fields.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No fields yet. Add your first field above.</p>
          ) : (
            <div className="space-y-2">
              {fields.map(field => (
                <div key={field.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{field.field_label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {field.field_type} · {field.section}
                      {field.ai_description && <span className="ml-2 italic">"{field.ai_description}"</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(field.id, field.field_label)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-red-400 hover:text-red-600 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-all">
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex justify-end">
          <button onClick={onClose} className="btn-secondary">Done</button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline Cell Input ────────────────────────────────────────────────────────

function CellInput({
  field, value, onChange, onCommit, onCancel
}: {
  field: any;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    if (ref.current && 'select' in ref.current) (ref.current as HTMLInputElement).select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && field.field_type !== 'textarea') { e.preventDefault(); onCommit(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    e.stopPropagation();
  };

  if (field.field_type === 'select') {
    return (
      <select
        ref={ref as any}
        className="w-full text-xs bg-white dark:bg-gray-800 border-0 outline-none rounded dark:text-gray-100 py-0"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onCommit}
      >
        <option value="">—</option>
        {(field.options || []).map((o: string) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (field.field_type === 'boolean') {
    return (
      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
        {['Yes', 'No', 'Unclear'].map(opt => (
          <button key={opt} type="button"
            onMouseDown={e => { e.preventDefault(); onChange(opt); onCommit(); }}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              value === opt
                ? 'bg-brand-600 text-white border-brand-600'
                : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-brand-400'
            }`}>
            {opt}
          </button>
        ))}
      </div>
    );
  }

  if (field.field_type === 'textarea') {
    return (
      <textarea
        ref={ref as any}
        className="w-full text-xs border-0 bg-transparent outline-none dark:text-gray-100 resize-none"
        rows={3}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <input
      ref={ref as any}
      type={field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : 'text'}
      className="w-full text-xs border-0 bg-transparent outline-none dark:text-gray-100"
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={handleKeyDown}
    />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DataExtraction() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const qc = useQueryClient();

  const [showFieldManager, setShowFieldManager] = useState(false);
  const [editingCell, setEditingCell] = useState<{ articleId: string; fieldId: string } | null>(null);
  const [cellValues, setCellValues] = useState<Record<string, Record<string, string>>>({});
  const [aiRunning, setAiRunning] = useState<Set<string>>(new Set());
  const [aiAllRunning, setAiAllRunning] = useState(false);

  const { data: summary, isLoading } = useQuery(
    ['extraction-summary', reviewId],
    () => extractionApi.summary(reviewId!).then(r => r.data),
    { enabled: !!reviewId, refetchOnWindowFocus: false }
  );

  const fields: any[] = summary?.fields || [];
  const articles: any[] = summary?.articles || [];

  // Sync server data into local cell values (but don't overwrite what's being edited)
  useEffect(() => {
    if (!summary) return;
    setCellValues(prev => {
      const next = { ...prev };
      for (const a of summary.articles) {
        if (!next[a.id]) next[a.id] = {};
        for (const [fid, val] of Object.entries(a.extracted as Record<string, string>)) {
          if (!editingCell || editingCell.articleId !== a.id || editingCell.fieldId !== fid) {
            next[a.id][fid] = val as string;
          }
        }
      }
      return next;
    });
  }, [summary]);

  const getCellValue = (articleId: string, fieldId: string) =>
    cellValues[articleId]?.[fieldId] ?? '';

  const setCellValue = (articleId: string, fieldId: string, value: string) => {
    setCellValues(prev => ({
      ...prev,
      [articleId]: { ...(prev[articleId] || {}), [fieldId]: value }
    }));
  };

  const saveCell = useCallback(async (articleId: string, fieldId: string, value: string) => {
    try {
      await extractionApi.saveField(reviewId!, articleId, { field_id: fieldId, value });
    } catch {
      toast.error('Failed to save cell');
    }
  }, [reviewId]);

  const handleCellCommit = useCallback((articleId: string, fieldId: string) => {
    const value = cellValues[articleId]?.[fieldId] ?? '';
    saveCell(articleId, fieldId, value);
    setEditingCell(null);
  }, [cellValues, saveCell]);

  // ─── AI extract single article ───────────────────────────────────────────────
  const handleAiExtract = async (articleId: string) => {
    setAiRunning(prev => new Set(prev).add(articleId));
    try {
      const { data } = await extractionApi.aiExtract(reviewId!, articleId);
      const fresh = await extractionApi.getData(reviewId!, articleId);
      const map: Record<string, string> = {};
      for (const d of fresh.data as any[]) map[d.field_id] = d.value;
      setCellValues(prev => ({ ...prev, [articleId]: map }));
      toast.success(`AI filled ${data.fields_populated} field${data.fields_populated !== 1 ? 's' : ''}`);
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.error || 'AI extraction failed';
      if (msg.includes('Ollama') || msg.includes('ECONNREFUSED')) {
        toast.error('Ollama not running. Start with: ollama serve', { duration: 5000 });
      } else if (msg.includes('model') || msg.includes('pull')) {
        toast.error('Run: ollama pull llama3.2', { duration: 5000 });
      } else {
        toast.error(msg);
      }
    } finally {
      setAiRunning(prev => { const s = new Set(prev); s.delete(articleId); return s; });
    }
  };

  // ─── AI extract all articles ─────────────────────────────────────────────────
  const handleAiExtractAll = async () => {
    if (!articles.length || !fields.length) return;
    if (!confirm(`Run AI extraction on all ${articles.length} articles? This reads each full-text PDF and may take a while.`)) return;
    setAiAllRunning(true);
    let success = 0;
    for (const article of articles) {
      try {
        const { data } = await extractionApi.aiExtract(reviewId!, article.id);
        const fresh = await extractionApi.getData(reviewId!, article.id);
        const map: Record<string, string> = {};
        for (const d of fresh.data as any[]) map[d.field_id] = d.value;
        setCellValues(prev => ({ ...prev, [article.id]: map }));
        success++;
      } catch {}
    }
    toast.success(`AI extraction complete: ${success}/${articles.length} articles processed`);
    setAiAllRunning(false);
  };

  // ─── Download CSV ─────────────────────────────────────────────────────────────
  const downloadCsv = () => {
    const headers = ['#', 'Citation', 'Title', 'Journal', 'Year', 'DOI', ...fields.map(f => f.field_label)];
    const rows = articles.map((a, i) => [
      String(i + 1),
      a.citation || '',
      a.title || '',
      a.journal || '',
      String(a.year || ''),
      a.doi || '',
      ...fields.map(f => getCellValue(a.id, f.id)),
    ]);
    const esc = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map(row => row.map(esc).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'extraction.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Download Excel ───────────────────────────────────────────────────────────
  const downloadXlsx = async () => {
    try {
      const XLSX = await import('xlsx');
      const headers = ['#', 'Citation', 'Title', 'Journal', 'Year', 'DOI', ...fields.map(f => f.field_label)];
      const rows = articles.map((a, i) => [
        i + 1,
        a.citation || '',
        a.title || '',
        a.journal || '',
        a.year || '',
        a.doi || '',
        ...fields.map(f => getCellValue(a.id, f.id)),
      ]);
      const ws = (XLSX as any).utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = [
        { wch: 4 }, { wch: 16 }, { wch: 40 }, { wch: 22 }, { wch: 6 }, { wch: 22 },
        ...fields.map(() => ({ wch: 22 }))
      ];
      const wb = (XLSX as any).utils.book_new();
      (XLSX as any).utils.book_append_sheet(wb, ws, 'Extraction');
      (XLSX as any).writeFile(wb, 'extraction.xlsx');
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate Excel file — make sure xlsx package is installed');
    }
  };

  // ─── Loading ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading extraction data...</p>
        </div>
      </div>
    );
  }

  const totalCells = articles.length * fields.length;
  const filledCells = articles.reduce((sum, a) =>
    sum + fields.filter(f => getCellValue(a.id, f.id)).length, 0);

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">

      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Data Extraction</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {articles.length} article{articles.length !== 1 ? 's' : ''} with full text · {fields.length} field{fields.length !== 1 ? 's' : ''}
              {totalCells > 0 && (
                <span className="ml-2 text-brand-600 dark:text-brand-400 font-medium">
                  {filledCells}/{totalCells} cells filled ({Math.round(filledCells / totalCells * 100)}%)
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowFieldManager(true)} className="btn-secondary text-sm py-2">
              <Cog6ToothIcon className="w-4 h-4" /> Manage Fields
            </button>
            <button
              onClick={handleAiExtractAll}
              disabled={aiAllRunning || !articles.length || !fields.length}
              className="btn-primary text-sm py-2">
              {aiAllRunning ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Extracting...
                </>
              ) : (
                <><SparklesIcon className="w-4 h-4" /> AI Extract All</>
              )}
            </button>
            <button onClick={downloadCsv} disabled={!articles.length} className="btn-secondary text-sm py-2">
              <ArrowDownTrayIcon className="w-4 h-4" /> CSV
            </button>
            <button onClick={downloadXlsx} disabled={!articles.length} className="btn-secondary text-sm py-2">
              <ArrowDownTrayIcon className="w-4 h-4" /> Excel
            </button>
          </div>
        </div>

        {aiAllRunning && (
          <div className="mt-3 flex items-center gap-3 text-sm text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/20 rounded-lg px-4 py-2">
            <SparklesIcon className="w-4 h-4 flex-shrink-0" />
            <span>AI is reading full-text PDFs and extracting data for each article… this may take a few minutes.</span>
          </div>
        )}
      </div>

      {/* Empty states */}
      {articles.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <p className="text-5xl mb-4">📊</p>
            <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">No articles ready for extraction</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Articles need a full-text PDF and must be included during full-text screening to appear here.
            </p>
          </div>
        </div>
      ) : fields.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <p className="text-5xl mb-4">🗂️</p>
            <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">No extraction fields defined</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Define the fields you want to extract, then use AI or fill them in manually.
            </p>
            <button onClick={() => setShowFieldManager(true)} className="btn-primary">
              <PlusIcon className="w-4 h-4" /> Add Fields
            </button>
          </div>
        </div>
      ) : (
        /* ─── Spreadsheet ─── */
        <div className="flex-1 overflow-auto">
          <table className="border-collapse min-w-full text-xs">
            <thead className="sticky top-0 z-30">
              <tr className="bg-gray-100 dark:bg-gray-800 border-b-2 border-gray-300 dark:border-gray-600">
                {/* # */}
                <th className="sticky left-0 z-40 bg-gray-100 dark:bg-gray-800 px-3 py-3 text-left font-semibold text-gray-500 dark:text-gray-400 w-10 border-r border-gray-300 dark:border-gray-600 text-center">
                  #
                </th>
                {/* Citation */}
                <th className="sticky left-10 z-40 bg-gray-100 dark:bg-gray-800 px-3 py-3 text-left font-semibold text-gray-500 dark:text-gray-400 w-36 border-r border-gray-300 dark:border-gray-600">
                  Citation
                </th>
                {/* Title */}
                <th className="sticky left-[184px] z-40 bg-gray-100 dark:bg-gray-800 px-3 py-3 text-left font-semibold text-gray-500 dark:text-gray-400 w-56 border-r border-gray-300 dark:border-gray-600">
                  Title
                </th>
                {/* Dynamic fields */}
                {fields.map(field => (
                  <th key={field.id}
                    className="px-3 py-3 text-left font-semibold text-gray-500 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700 whitespace-nowrap"
                    title={field.ai_description || field.field_label}
                    style={{ minWidth: '140px', maxWidth: '200px' }}>
                    <span className="block truncate">{field.field_label}</span>
                    <span className="text-gray-300 dark:text-gray-600 font-normal text-xs">({field.field_type})</span>
                  </th>
                ))}
                {/* AI column */}
                <th className="sticky right-0 z-40 bg-gray-100 dark:bg-gray-800 px-2 py-3 text-center font-semibold text-gray-500 dark:text-gray-400 w-14 border-l border-gray-300 dark:border-gray-600">
                  AI
                </th>
              </tr>
            </thead>
            <tbody>
              {articles.map((article, rowIdx) => {
                const rowBg = rowIdx % 2 === 0
                  ? 'bg-white dark:bg-gray-900'
                  : 'bg-gray-50/70 dark:bg-gray-900/60';

                return (
                  <tr key={article.id}
                    className={`border-b border-gray-100 dark:border-gray-800 hover:bg-brand-50/40 dark:hover:bg-brand-900/10 transition-colors group`}>

                    {/* Row # */}
                    <td className={`sticky left-0 z-20 ${rowBg} px-3 py-2 text-center text-gray-400 dark:text-gray-600 font-mono border-r border-gray-100 dark:border-gray-800 group-hover:bg-brand-50/40 dark:group-hover:bg-brand-900/10`}>
                      {rowIdx + 1}
                    </td>

                    {/* Citation */}
                    <td className={`sticky left-10 z-20 ${rowBg} px-3 py-2 border-r border-gray-100 dark:border-gray-800 group-hover:bg-brand-50/40 dark:group-hover:bg-brand-900/10`}
                      style={{ width: '144px', maxWidth: '144px' }}>
                      <span className="block truncate text-gray-700 dark:text-gray-300 font-medium" title={article.citation}>
                        {article.citation || '—'}
                      </span>
                    </td>

                    {/* Title */}
                    <td className={`sticky left-[184px] z-20 ${rowBg} px-3 py-2 border-r border-gray-100 dark:border-gray-800 group-hover:bg-brand-50/40 dark:group-hover:bg-brand-900/10`}
                      style={{ width: '224px', maxWidth: '224px' }}>
                      <span className="block truncate text-gray-700 dark:text-gray-300" title={article.title}>
                        {article.title}
                      </span>
                    </td>

                    {/* Data cells */}
                    {fields.map(field => {
                      const isEditing = editingCell?.articleId === article.id && editingCell?.fieldId === field.id;
                      const value = getCellValue(article.id, field.id);

                      return (
                        <td key={field.id}
                          onClick={() => { if (!isEditing) setEditingCell({ articleId: article.id, fieldId: field.id }); }}
                          className={`px-3 py-2 border-r border-gray-100 dark:border-gray-800 align-top cursor-text transition-colors ${
                            isEditing
                              ? 'bg-brand-50 dark:bg-brand-900/30 ring-2 ring-inset ring-brand-500 z-10 relative'
                              : 'hover:bg-brand-50/50 dark:hover:bg-brand-900/10'
                          }`}
                          style={{ minWidth: '140px', maxWidth: '200px' }}>
                          {isEditing ? (
                            <CellInput
                              field={field}
                              value={value}
                              onChange={v => setCellValue(article.id, field.id, v)}
                              onCommit={() => handleCellCommit(article.id, field.id)}
                              onCancel={() => setEditingCell(null)}
                            />
                          ) : (
                            <span
                              className={`block truncate ${value
                                ? 'text-gray-800 dark:text-gray-200'
                                : 'text-gray-300 dark:text-gray-600 italic select-none'
                              }`}
                              title={value || undefined}
                            >
                              {value || '—'}
                            </span>
                          )}
                        </td>
                      );
                    })}

                    {/* AI button */}
                    <td className={`sticky right-0 z-20 ${rowBg} px-2 py-2 text-center border-l border-gray-100 dark:border-gray-800 group-hover:bg-brand-50/40 dark:group-hover:bg-brand-900/10`}>
                      <button
                        onClick={() => handleAiExtract(article.id)}
                        disabled={aiRunning.has(article.id) || aiAllRunning}
                        title={`AI extract: ${article.title}`}
                        className="p-1.5 rounded-lg hover:bg-brand-100 dark:hover:bg-brand-900/30 text-brand-500 dark:text-brand-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                        {aiRunning.has(article.id) ? (
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        ) : (
                          <SparklesIcon className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showFieldManager && (
        <FieldManager reviewId={reviewId!} fields={fields} onClose={() => setShowFieldManager(false)} />
      )}
    </div>
  );
}
