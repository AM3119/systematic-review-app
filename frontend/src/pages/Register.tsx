import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { authApi } from '../api/client';
import { useAuthStore } from '../store/auth';

export default function Register() {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirm) return toast.error('Passwords do not match');
    setLoading(true);
    try {
      const { data } = await authApi.register({ name: form.name, email: form.email, password: form.password });
      setAuth(data.user, data.token);
      toast.success('Welcome to SystematicAI! 🎉');
      navigate('/');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-brand-700 via-brand-600 to-violet-600 flex-col justify-center px-16 text-white">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span className="text-2xl font-bold">SystematicAI</span>
          </div>
          <h1 className="text-4xl font-bold leading-tight mb-4">Start your systematic review today</h1>
          <p className="text-brand-200 text-lg">Join researchers worldwide conducting rigorous evidence synthesis.</p>
        </div>
        <div className="space-y-4">
          {[
            { icon: '📚', title: 'Import from any database', desc: 'PubMed, Embase, Cochrane, Web of Science — RIS, BibTeX, CSV' },
            { icon: '🤖', title: 'AI-powered screening', desc: 'Automatic duplicate detection with similarity scoring' },
            { icon: '🔒', title: 'Blinded review mode', desc: 'Prevent bias with hidden reviewer decisions' },
            { icon: '⚔️', title: 'Conflict resolution', desc: 'Built-in tools to resolve screening disagreements' },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="flex gap-4 bg-white/10 rounded-xl p-4">
              <span className="text-2xl">{icon}</span>
              <div>
                <div className="font-semibold text-sm">{title}</div>
                <div className="text-brand-200 text-xs mt-0.5">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-8">
        <div className="w-full max-w-md">
          <h2 className="text-2xl font-bold text-gray-900 mb-1">Create your account</h2>
          <p className="text-gray-500 mb-8">Free forever for academic use</p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label">Full name</label>
              <input className="input" type="text" placeholder="Dr. Jane Smith" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <label className="label">Email address</label>
              <input className="input" type="email" placeholder="you@institution.edu" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" placeholder="Min. 6 characters" value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={6} />
            </div>
            <div>
              <label className="label">Confirm password</label>
              <input className="input" type="password" placeholder="••••••••" value={form.confirm}
                onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} required />
            </div>
            <button type="submit" disabled={loading} className="w-full btn-primary justify-center py-2.5 text-base">
              {loading ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link to="/login" className="text-brand-600 font-medium hover:text-brand-700">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
