import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { articlesApi, extractionApi } from '../../api/client';
import { PlusIcon, TrashIcon, ChevronRightIcon, SparklesIcon } from '@heroicons/react/24/outline';

function FieldEditor({ reviewId, onClose }: { reviewId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    field_name: '', field_label: '', field_type: 'text',
    section: 'General', required: false, options: '', ai_description: ''
  });

  const createMutation = useMutation(
    (data: any) => extractionApi.createField(reviewId, data),
    { onSuccess: () => { qc.invalidateQueries(['extraction-fields', reviewId]); onClose(); toast.success('Field added'); } }
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
          <h3 className="font-semibold dark:text-gray-100">Add Extraction Field</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label">Field Label *</label>
            <input className="input" placeholder="e.g. Sample Size" value={form.field_label}
              onChange={e => setForm(f => ({ ...f, field_label: e.target.value, field_name: e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.field_type} onChange={e => setForm(f => ({ ...f, field_type: e.target.value }))}>
                {['text', 'textarea', 'number', 'select', 'multiselect', 'date', 'boolean'].map(t => (
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
          {['select', 'multiselect'].includes(form.field_type) && (
            <div>
              <label className="label">Options (comma-separated)</label>
              <input className="input" placeholder="RCT, Cohort, Case-Control" value={form.options}
                onChange={e => setForm(f => ({ ...f, options: e.target.value }))} />
            </div>
          )}
          <div>
            <label className="label">🤖 AI Extraction Hint</label>
            <input className="input" placeholder="e.g. The total number of participants enrolled in the study"
              value={form.ai_description} onChange={e => setForm(f => ({ ...f, ai_description: e.target.value }))} />
            <p className="text-xs text-gray-400 mt-1">Tells the AI what to look for when auto-extracting this field</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.required} onChange={e => setForm(f => ({ ...f, required: e.target.checked }))} className="rounded" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Required field</span>
          </label>
        </div>
        <div className="p-5 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => {
            if (!form.field_label) return toast.error('Label required');
            createMutation.mutate({ ...form, options: form.options ? form.options.split(',').map((o: string) => o.trim()) : [] });
          }} className="btn-primary">Add Field</button>
        </div>
      </div>
    </div>
  );
}

function ExtractionForm({ reviewId, article, fields, onBack }: { reviewId: string; article: any; fields: any[]; onBack: () => void }) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  useQuery(
    ['extraction-data', reviewId, article.id],
    () => extractionApi.getData(reviewId, article.id).then(r => {
      const map: Record<string, string> = {};
      for (const d of r.data) map[d.field_id] = d.value;
      setValues(map);
      return r.data;
    }),
    { enabled: !!article }
  );

  const handleAiExtract = async () => {
    setAiLoading(true);
    try {
      const { data } = await extractionApi.aiExtract(reviewId, article.id);
      const freshData = await extractionApi.getData(reviewId, article.id);
      const map: Record<string, string> = {};
      for (const d of freshData.data) map[d.field_id] = d.value;
      setValues(map);
      const src = data.content_source === 'FULL TEXT (from PDF)' ? '📄 full-text PDF' : '📝 abstract';
      toast.success(`🤖 AI extracted ${data.fields_populated} fields from ${src}`);
      qc.invalidateQueries(['extraction-data', reviewId, article.id]);
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.error || 'AI extraction failed';
      if (msg.includes('Ollama not running') || msg.includes('ECONNREFUSED')) {
        toast.error('Ollama is not running. Start it with: ollama serve', { duration: 6000 });
      } else if (msg.includes('model') || msg.includes('pull')) {
        toast.error(`Model not ready. Run: ollama pull llama3.2`, { duration: 6000 });
      } else {
        toast.error(msg);
      }
    } finally {
      setAiLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await extractionApi.saveBulk(reviewId, article.id,
        Object.entries(values).map(([field_id, value]) => ({ field_id, value })));
      toast.success('Extraction saved!');
      qc.invalidateQueries(['extraction-data', reviewId, article.id]);
    } catch { toast.error('Save failed'); }
    finally { setSaving(false); }
  };

  const sections = [...new Set(fields.map(f => f.section))];

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-gray-950">
      <div className="max-w-3xl mx-auto">
        <button onClick={onBack} className="btn-secondary text-sm mb-4">← Back to list</button>

        <div className="card p-5 mb-6">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-lg mb-1">{article.title}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{article.authors} · {article.journal} · {article.year}</p>
        </div>

        {/* AI extraction button */}
        <div className="card p-4 mb-6 bg-gradient-to-r from-brand-50 to-violet-50 dark:from-brand-900/20 dark:to-violet-900/20 border-brand-100 dark:border-brand-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-brand-800 dark:text-brand-300 flex items-center gap-2">
                <SparklesIcon className="w-5 h-5" />
                AI Auto-Extraction
              </p>
              <p className="text-sm text-brand-600 dark:text-brand-400 mt-0.5">
                Local AI (Ollama) reads the abstract and populates all fields — no internet required
              </p>
            </div>
            <button onClick={handleAiExtract} disabled={aiLoading}
              className="btn-primary bg-gradient-to-r from-brand-600 to-violet-600 hover:from-brand-700 hover:to-violet-700 flex-shrink-0">
              <SparklesIcon className="w-4 h-4" />
              {aiLoading ? 'Extracting...' : 'Auto-Extract with AI'}
            </button>
          </div>
          {aiLoading && (
            <div className="mt-3 flex items-center gap-2 text-sm text-brand-600 dark:text-brand-400">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              AI is reading the article and extracting data...
            </div>
          )}
        </div>

        {sections.map(section => (
          <div key={section} className="card p-5 mb-4">
            <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-4 pb-2 border-b border-gray-100 dark:border-gray-800">{section}</h3>
            <div className="space-y-4">
              {fields.filter(f => f.section === section).map(field => (
                <div key={field.id}>
                  <label className="label">
                    {field.field_label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                    {field.ai_description && <span className="ml-2 text-xs text-gray-400 font-normal">({field.ai_description})</span>}
                  </label>
                  {field.field_type === 'textarea' ? (
                    <textarea className="input resize-none h-20" value={values[field.id] || ''}
                      onChange={e => setValues(v => ({ ...v, [field.id]: e.target.value }))} />
                  ) : field.field_type === 'select' ? (
                    <select className="input" value={values[field.id] || ''}
                      onChange={e => setValues(v => ({ ...v, [field.id]: e.target.value }))}>
                      <option value="">Select...</option>
                      {field.options.map((o: string) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : field.field_type === 'boolean' ? (
                    <div className="flex gap-3">
                      {['Yes', 'No', 'Unclear'].map(opt => (
                        <button key={opt} onClick={() => setValues(v => ({ ...v, [field.id]: opt }))}
                          className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                            values[field.id] === opt
                              ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300'
                              : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                          }`}>
                          {opt}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input className="input"
                      type={field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : 'text'}
                      value={values[field.id] || ''}
                      onChange={e => setValues(v => ({ ...v, [field.id]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex justify-end gap-3">
          <button onClick={onBack} className="btn-secondary">Back</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : '💾 Save Extraction'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DataExtraction() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const qc = useQueryClient();
  const [selectedArticle, setSelectedArticle] = useState<any>(null);
  const [showAddField, setShowAddField] = useState(false);

  const { data: fields = [] } = useQuery(
    ['extraction-fields', reviewId],
    () => extractionApi.fields(reviewId!).then(r => r.data),
    { enabled: !!reviewId }
  );

  const { data: articlesData } = useQuery(
    ['included-articles', reviewId],
    () => articlesApi.list(reviewId!, { phase: 'fulltext', decision: 'include', limit: 500 }).then(r => r.data),
    { enabled: !!reviewId }
  );

  const articles = articlesData?.articles || [];

  const deleteField = useMutation(
    (fieldId: string) => extractionApi.deleteField(reviewId!, fieldId),
    { onSuccess: () => { qc.invalidateQueries(['extraction-fields', reviewId]); toast.success('Field deleted'); } }
  );

  if (selectedArticle) {
    return <ExtractionForm reviewId={reviewId!} article={selectedArticle} fields={fields} onBack={() => setSelectedArticle(null)} />;
  }

  return (
    <div className="flex-1 overflow-hidden flex bg-gray-50 dark:bg-gray-950">
      {/* Fields sidebar */}
      <div className="w-72 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Extraction Fields</h3>
          <button onClick={() => setShowAddField(true)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-brand-600">
            <PlusIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {(fields as any[]).map((field: any) => (
            <div key={field.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 group">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{field.field_label}</p>
                <p className="text-xs text-gray-400">{field.field_type} · {field.section}</p>
              </div>
              <button onClick={() => { if (confirm('Delete this field?')) deleteField.mutate(field.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 transition-opacity">
                <TrashIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {fields.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">No fields yet. Add your first field →</p>
          )}
        </div>
        <div className="p-3 border-t border-gray-100 dark:border-gray-800">
          <div className="bg-brand-50 dark:bg-brand-900/20 rounded-lg p-3">
            <p className="text-xs font-medium text-brand-700 dark:text-brand-300 mb-1">🤖 AI Auto-Extraction</p>
            <p className="text-xs text-brand-600 dark:text-brand-400">Add an "AI Extraction Hint" to each field so Claude knows what to look for.</p>
          </div>
        </div>
      </div>

      {/* Articles */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Data Extraction</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {articles.length} included article{articles.length !== 1 ? 's' : ''} from full-text screening
            </p>
          </div>
        </div>

        {articles.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="text-gray-400">No articles included from full-text screening yet</p>
            <p className="text-sm text-gray-400 mt-1">Go to Full-Text Screening and include articles to enable extraction</p>
          </div>
        ) : (
          <div className="space-y-2">
            {articles.map((article: any) => (
              <button key={article.id} onClick={() => setSelectedArticle(article)}
                className="card w-full text-left p-4 hover:shadow-md hover:border-brand-200 dark:hover:border-brand-700 transition-all group">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors truncate">
                      {article.title}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                      {article.authors?.split(';')[0]?.trim()} · {article.journal} · {article.year}
                    </p>
                  </div>
                  <ChevronRightIcon className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-brand-500 flex-shrink-0 transition-colors" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {showAddField && <FieldEditor reviewId={reviewId!} onClose={() => setShowAddField(false)} />}
    </div>
  );
}
