import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { reviewsApi } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { TrashIcon } from '@heroicons/react/24/outline';

export default function Settings() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);

  const { data: review } = useQuery(['review', reviewId], () => reviewsApi.get(reviewId!).then(r => r.data));
  const [form, setForm] = useState({ title: '', description: '', inclusion_criteria: '', exclusion_criteria: '', blinding_enabled: true, status: 'active' });

  useEffect(() => {
    if (review) {
      setForm({
        title: review.title || '',
        description: review.description || '',
        inclusion_criteria: review.inclusion_criteria || '',
        exclusion_criteria: review.exclusion_criteria || '',
        blinding_enabled: review.blinding_enabled === 1,
        status: review.status || 'active',
      });
    }
  }, [review]);

  const updateMutation = useMutation(
    (data: any) => reviewsApi.update(reviewId!, data),
    {
      onSuccess: () => {
        qc.invalidateQueries(['review', reviewId]);
        toast.success('Settings saved');
      }
    }
  );

  const deleteMutation = useMutation(
    () => reviewsApi.delete(reviewId!),
    {
      onSuccess: () => {
        navigate('/');
        toast.success('Review deleted');
      }
    }
  );

  const isOwner = review?.owner_id === user?.id;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Review Settings</h2>

        <div className="card p-6 mb-6 space-y-4">
          <h3 className="font-semibold text-gray-900 border-b border-gray-100 pb-3">General</h3>
          <div>
            <label className="label">Review Title</label>
            <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input resize-none h-20" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>

        <div className="card p-6 mb-6 space-y-4">
          <h3 className="font-semibold text-gray-900 border-b border-gray-100 pb-3">PICOS / Criteria</h3>
          <div>
            <label className="label">Inclusion Criteria</label>
            <textarea className="input resize-none h-28" value={form.inclusion_criteria}
              onChange={e => setForm(f => ({ ...f, inclusion_criteria: e.target.value }))}
              placeholder="Describe what studies should be included..." />
          </div>
          <div>
            <label className="label">Exclusion Criteria</label>
            <textarea className="input resize-none h-28" value={form.exclusion_criteria}
              onChange={e => setForm(f => ({ ...f, exclusion_criteria: e.target.value }))}
              placeholder="Describe what studies should be excluded..." />
          </div>
        </div>

        <div className="card p-6 mb-6">
          <h3 className="font-semibold text-gray-900 border-b border-gray-100 pb-3 mb-4">Collaboration Settings</h3>
          <div className="flex items-start justify-between p-4 bg-amber-50 rounded-xl border border-amber-100">
            <div>
              <p className="font-medium text-amber-800">🔒 Blinded Review Mode</p>
              <p className="text-sm text-amber-600 mt-1">When enabled, reviewers cannot see each other's decisions during screening. This prevents anchoring bias and ensures independent assessment.</p>
            </div>
            <button onClick={() => setForm(f => ({ ...f, blinding_enabled: !f.blinding_enabled }))}
              className={`relative w-12 h-6 rounded-full transition-all duration-200 flex-shrink-0 ml-4 ${form.blinding_enabled ? 'bg-brand-600' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200 ${form.blinding_enabled ? 'right-0.5' : 'left-0.5'}`} />
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-3 mb-8">
          <button onClick={() => updateMutation.mutate(form)} disabled={updateMutation.isLoading} className="btn-primary">
            {updateMutation.isLoading ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

        {isOwner && (
          <div className="card p-6 border-red-200 bg-red-50">
            <h3 className="font-semibold text-red-800 mb-2">Danger Zone</h3>
            <p className="text-sm text-red-600 mb-4">Deleting this review will permanently remove all articles, decisions, and data. This cannot be undone.</p>
            <button onClick={() => {
              if (confirm(`Delete "${review?.title}"? This cannot be undone.`)) deleteMutation.mutate();
            }} className="btn-danger flex items-center gap-2">
              <TrashIcon className="w-4 h-4" />
              Delete Review
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
