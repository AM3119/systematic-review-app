import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { reviewsApi } from '../api/client';
import { useAuthStore } from '../store/auth';
import Avatar from '../components/common/Avatar';
import {
  PlusIcon, MagnifyingGlassIcon, ChevronRightIcon, BellIcon,
  FireIcon, TrophyIcon, UsersIcon, DocumentTextIcon, Cog6ToothIcon
} from '@heroicons/react/24/outline';

function CreateReviewModal({ onClose, onCreate }: { onClose: () => void; onCreate: (data: any) => void }) {
  const [form, setForm] = useState({ title: '', description: '', inclusion_criteria: '', exclusion_criteria: '', blinding_enabled: true });
  const [step, setStep] = useState(1);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="p-6 border-b border-gray-100">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Create New Review</h2>
              <p className="text-sm text-gray-500 mt-0.5">Step {step} of 2</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex gap-2 mt-4">
            {[1, 2].map(s => (
              <div key={s} className={`h-1.5 flex-1 rounded-full transition-all ${s <= step ? 'bg-brand-600' : 'bg-gray-200'}`} />
            ))}
          </div>
        </div>

        <div className="p-6 space-y-4">
          {step === 1 ? (
            <>
              <div>
                <label className="label">Review Title *</label>
                <input className="input" placeholder="e.g., Effectiveness of CBT for depression in adults" value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input resize-none h-20" placeholder="Brief description of the review scope and objectives..."
                  value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="flex items-center justify-between p-3 bg-amber-50 rounded-xl border border-amber-100">
                <div>
                  <p className="text-sm font-medium text-amber-800">🔒 Blinded Review</p>
                  <p className="text-xs text-amber-600 mt-0.5">Reviewers cannot see each other's decisions</p>
                </div>
                <button onClick={() => setForm(f => ({ ...f, blinding_enabled: !f.blinding_enabled }))}
                  className={`relative w-12 h-6 rounded-full transition-all duration-200 ${form.blinding_enabled ? 'bg-brand-600' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200 ${form.blinding_enabled ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="label">Inclusion Criteria</label>
                <textarea className="input resize-none h-24" placeholder="Studies must include:&#10;• Adult participants (≥18 years)&#10;• RCTs or quasi-experimental designs&#10;• Published in peer-reviewed journals"
                  value={form.inclusion_criteria} onChange={e => setForm(f => ({ ...f, inclusion_criteria: e.target.value }))} />
              </div>
              <div>
                <label className="label">Exclusion Criteria</label>
                <textarea className="input resize-none h-24" placeholder="Studies will be excluded if:&#10;• Animal studies&#10;• Conference abstracts only&#10;• Non-English language"
                  value={form.exclusion_criteria} onChange={e => setForm(f => ({ ...f, exclusion_criteria: e.target.value }))} />
              </div>
            </>
          )}
        </div>

        <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
          {step > 1 && <button onClick={() => setStep(1)} className="btn-secondary">Back</button>}
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          {step < 2 ? (
            <button onClick={() => { if (!form.title) return toast.error('Title required'); setStep(2); }} className="btn-primary">
              Next
            </button>
          ) : (
            <button onClick={() => onCreate(form)} className="btn-primary">
              Create Review
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');

  const { data: reviews = [] } = useQuery('reviews', () => reviewsApi.list().then(r => r.data));

  const createMutation = useMutation((data: any) => reviewsApi.create(data), {
    onSuccess: (res) => {
      qc.invalidateQueries('reviews');
      setShowCreate(false);
      toast.success('Review created!');
      navigate(`/reviews/${res.data.id}`);
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to create review')
  });

  const filtered = reviews.filter((r: any) =>
    r.title.toLowerCase().includes(search.toLowerCase())
  );

  const roleColors: Record<string, string> = {
    owner: 'bg-brand-100 text-brand-700',
    admin: 'bg-violet-100 text-violet-700',
    reviewer: 'bg-blue-100 text-blue-700',
    highlighter: 'bg-green-100 text-green-700',
    viewer: 'bg-gray-100 text-gray-600',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-brand-600 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span className="text-xl font-bold text-gray-900">SystematicAI</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-brand-50 px-3 py-1.5 rounded-lg">
              <TrophyIcon className="w-4 h-4 text-brand-600" />
              <span className="text-sm font-semibold text-brand-700">{user?.points || 0} pts</span>
            </div>
            {(user?.streak || 0) > 0 && (
              <div className="flex items-center gap-1.5 bg-orange-50 px-3 py-1.5 rounded-lg">
                <FireIcon className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-semibold text-orange-600">{user?.streak} day streak</span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <Avatar name={user?.name || ''} color={user?.avatar_color} size="sm" />
              <div>
                <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                <p className="text-xs text-gray-400">{user?.email}</p>
              </div>
            </div>
            <button onClick={() => { logout(); navigate('/login'); }}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Hero greeting */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back, {user?.name?.split(' ')[0]} 👋
          </h1>
          <p className="text-gray-500 mt-1">Manage your systematic reviews and meta-analyses</p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Reviews', value: reviews.length, icon: DocumentTextIcon, color: 'text-brand-600 bg-brand-50' },
            { label: 'Active Reviews', value: reviews.filter((r: any) => r.status === 'active').length, icon: MagnifyingGlassIcon, color: 'text-emerald-600 bg-emerald-50' },
            { label: 'Collaborations', value: reviews.filter((r: any) => r.my_role !== 'owner').length, icon: UsersIcon, color: 'text-violet-600 bg-violet-50' },
            { label: 'Total Points', value: user?.points || 0, icon: TrophyIcon, color: 'text-amber-600 bg-amber-50' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-500">{label}</span>
                <div className={`p-2 rounded-lg ${color}`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>

        {/* Reviews */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">My Reviews</h2>
          <div className="flex gap-3">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input className="input pl-9 w-56 py-1.5 text-sm" placeholder="Search reviews..."
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              <PlusIcon className="w-4 h-4" />
              New Review
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="card p-16 text-center">
            <div className="w-16 h-16 bg-brand-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <DocumentTextIcon className="w-8 h-8 text-brand-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No reviews yet</h3>
            <p className="text-gray-500 mb-6">Create your first systematic review to get started</p>
            <button onClick={() => setShowCreate(true)} className="btn-primary mx-auto">
              <PlusIcon className="w-4 h-4" />
              Create your first review
            </button>
          </div>
        ) : (
          <div className="grid gap-4">
            {filtered.map((review: any) => (
              <div key={review.id} onClick={() => navigate(`/reviews/${review.id}`)}
                className="card p-5 cursor-pointer hover:shadow-md hover:border-brand-200 transition-all duration-200 group">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900 group-hover:text-brand-700 transition-colors truncate">{review.title}</h3>
                      <span className={`badge flex-shrink-0 ${roleColors[review.my_role] || 'bg-gray-100 text-gray-600'}`}>
                        {review.my_role}
                      </span>
                      {review.blinding_enabled ? <span className="badge bg-amber-50 text-amber-700 flex-shrink-0">🔒 Blinded</span> : null}
                      <span className={`badge flex-shrink-0 ${review.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {review.status}
                      </span>
                    </div>
                    {review.description && <p className="text-sm text-gray-500 line-clamp-1">{review.description}</p>}
                    <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                      <span className="flex items-center gap-1"><UsersIcon className="w-3.5 h-3.5" />{review.member_count} members</span>
                      <span className="flex items-center gap-1"><DocumentTextIcon className="w-3.5 h-3.5" />{review.article_count} articles</span>
                      <span>{new Date(review.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <ChevronRightIcon className="w-5 h-5 text-gray-300 group-hover:text-brand-500 flex-shrink-0 transition-colors" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateReviewModal
          onClose={() => setShowCreate(false)}
          onCreate={(data) => createMutation.mutate(data)}
        />
      )}
    </div>
  );
}
