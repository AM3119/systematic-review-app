import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { articlesApi, extractionApi } from '../../api/client';
import { PlusIcon, TrashIcon, ChevronRightIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

function FieldEditor({ reviewId, onClose }: { reviewId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ field_name: '', field_label: '', field_type: 'text', section: 'General', required: false, options: '' });

  const createMutation = useMutation(
    (data: any) => extractionApi.createField(reviewId, data),
    { onSuccess: () => { qc.invalidateQueries(['extraction-fields', reviewId]); onClose(); toast.success('Field added'); } }
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-5 border-b border-gray-100 flex justify-between items-center">
          <h3 className="font-semibold">Add Extraction Field</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="label">Field Label *</label>
            <input className="input" placeholder="e.g., Sample Size" value={form.field_label}
              onChange={e => setForm(f => ({ ...f, field_label: e.target.value, field_name: e.target.value.toLowerCase().replace(/\s+/g, '_') }))} />
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
              <input className="input" placeholder="Option 1, Option 2, Option 3" value={form.options}
                onChange={e => setForm(f => ({ ...f, options: e.target.value }))} />
            </div>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.required} onChange={e => setForm(f => ({ ...f, required: e.target.checked }))} className="rounded" />
            <span className="text-sm text-gray-700">Required field</span>
          </label>
        </div>
        <div className="p-5 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => {
            if (!form.field_label) return toast.error('Label required');
            createMutation.mutate({
              ...form,
              options: form.options ? form.options.split(',').map(o => o.trim()) : []
            });
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

  const { data: existingData } = useQuery(
    ['extraction-data', reviewId, article.id],
    () => extractionApi.getData(reviewId, article.id).then(r => {
      const map: Record<string, string> = {};
      for (const d of r.data) map[d.field_id] = d.value;
      setValues(map);
      return r.data;
    }),
    { enabled: !!article }
  );

  const sections = [...new Set(fields.map(f => f.section))];

  const handleSave = async () => {
    setSaving(true);
    try {
      await extractionApi.saveBulk(reviewId, article.id, Object.entries(values).map(([field_id, value]) => ({ field_id, value })));
      toast.success('Extraction saved!');
      qc.invalidateQueries(['extraction-data', reviewId, article.id]);
    } catch { toast.error('Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <button onClick={onBack} className="btn-secondary text-sm mb-4">← Back to list</button>
        <div className="card p-5 mb-6">
          <h2 className="font-semibold text-gray-900 text-lg mb-2">{article.title}</h2>
          <p className="text-sm text-gray-500">{article.authors} · {article.journal} · {article.year}</p>
        </div>

        {sections.map(section => (
          <div key={section} className="card p-5 mb-4">
            <h3 className="font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-100">{section}</h3>
            <div className="space-y-4">
              {fields.filter(f => f.section === section).map(field => (
                <div key={field.id}>
                  <label className="label">{field.field_label} {field.required && <span className="text-red-500">*</span>}</label>
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
                          className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${values[field.id] === opt ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                          {opt}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input className="input" type={field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : 'text'}
                      value={values[field.id] || ''}
                      onChange={e => setValues(v => ({ ...v, [field.id]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex justify-end">
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
    () => articlesApi.list(reviewId!, { phase: 'fulltext', decision: 'include', limit: 200 }).then(r => r.data),
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
    <div className="flex-1 overflow-hidden flex">
      {/* Fields sidebar */}
      <div className="w-72 border-r border-gray-200 bg-white flex flex-col">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Extraction Fields</h3>
          <button onClick={() => setShowAddField(true)} className="p-1.5 rounded-lg hover:bg-gray-100 text-brand-600">
            <PlusIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {fields.map((field: any) => (
            <div key={field.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 group">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{field.field_label}</p>
                <p className="text-xs text-gray-400">{field.field_type} · {field.section}</p>
              </div>
              <button onClick={() => { if (confirm('Delete this field?')) deleteField.mutate(field.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600">
                <TrashIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Articles list */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Data Extraction</h2>
            <p className="text-sm text-gray-500 mt-0.5">{articles.length} included articles</p>
          </div>
        </div>

        {articles.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="text-gray-400">No articles included from full-text screening yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {articles.map((article: any) => (
              <button key={article.id} onClick={() => setSelectedArticle(article)}
                className="card w-full text-left p-4 hover:shadow-md hover:border-brand-200 transition-all group">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 group-hover:text-brand-700 transition-colors truncate">{article.title}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{article.authors?.split(';')[0]} · {article.journal} · {article.year}</p>
                  </div>
                  <ChevronRightIcon className="w-4 h-4 text-gray-300 group-hover:text-brand-500 flex-shrink-0" />
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
