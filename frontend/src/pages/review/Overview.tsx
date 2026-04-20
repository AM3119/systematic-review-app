import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from 'react-query';
import { useState, useRef } from 'react';
import toast from 'react-hot-toast';
import { reviewsApi, articlesApi } from '../../api/client';
import ProgressBar from '../../components/common/ProgressBar';
import Avatar from '../../components/common/Avatar';
import {
  ArrowUpTrayIcon, DocumentDuplicateIcon,
  CheckCircleIcon, XCircleIcon, QuestionMarkCircleIcon, ClockIcon
} from '@heroicons/react/24/outline';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

export default function ReviewOverview() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: stats, refetch: refetchStats } = useQuery(
    ['stats', reviewId],
    () => reviewsApi.stats(reviewId!).then(r => r.data),
    { enabled: !!reviewId }
  );

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const { data } = await articlesApi.import(reviewId!, file);
      toast.success(`Imported ${data.imported} articles successfully!`);
      refetchStats();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Import failed');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const abstractPieData = [
    { name: 'Include', value: stats?.included_abstract || 0, color: '#10B981' },
    { name: 'Exclude', value: stats?.excluded_abstract || 0, color: '#EF4444' },
    { name: 'Maybe', value: stats?.maybe_abstract || 0, color: '#F59E0B' },
    { name: 'Unscreened', value: Math.max(0, (stats?.unique || 0) - (stats?.screened || 0)), color: '#E5E7EB' },
  ].filter(d => d.value > 0);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Action buttons */}
      <div className="flex gap-3 mb-6">
        <label className={`btn-primary cursor-pointer ${importing ? 'opacity-60 pointer-events-none' : ''}`}>
          <ArrowUpTrayIcon className="w-4 h-4" />
          {importing ? 'Importing...' : 'Import Articles'}
          <input ref={fileRef} type="file" accept=".ris,.bib,.csv" className="hidden" onChange={handleImport} />
        </label>
      </div>

      {/* Main stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Imported', value: stats?.total || 0, icon: '📥', color: 'bg-blue-50 border-blue-100', text: 'text-blue-700' },
          { label: 'Duplicates', value: stats?.duplicates || 0, icon: '🔄', color: 'bg-orange-50 border-orange-100', text: 'text-orange-700' },
          { label: 'Unique Articles', value: stats?.unique || 0, icon: '📄', color: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-700' },
          { label: 'Conflicts', value: stats?.conflicts || 0, icon: '⚠️', color: 'bg-red-50 border-red-100', text: 'text-red-700' },
        ].map(({ label, value, icon, color, text }) => (
          <div key={label} className={`card border p-5 ${color}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-500">{label}</span>
              <span className="text-xl">{icon}</span>
            </div>
            <p className={`text-3xl font-bold ${text}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Screening progress */}
        <div className="card p-5">
          <h3 className="font-semibold text-gray-900 mb-4">My Screening Progress</h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Abstract Screening</span>
                <span className="font-medium text-gray-900">{stats?.screened_pct || 0}%</span>
              </div>
              <ProgressBar value={stats?.screened || 0} max={stats?.unique || 1} showLabel={false} size="lg" animated={false} />
              <p className="text-xs text-gray-400 mt-1">{stats?.screened || 0} of {stats?.unique || 0} screened</p>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Full-Text Screening</span>
                <span className="font-medium text-gray-900">
                  {stats?.included_abstract > 0 ? Math.round((stats?.included_fulltext || 0) / stats.included_abstract * 100) : 0}%
                </span>
              </div>
              <ProgressBar value={stats?.included_fulltext || 0} max={stats?.included_abstract || 1} showLabel={false} size="lg" color="bg-violet-500" />
              <p className="text-xs text-gray-400 mt-1">{stats?.included_fulltext || 0} of {stats?.included_abstract || 0} screened</p>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-3 gap-3 text-center">
            <div className="bg-emerald-50 rounded-lg p-2">
              <p className="text-lg font-bold text-emerald-700">{stats?.included_abstract || 0}</p>
              <p className="text-xs text-emerald-600">Included</p>
            </div>
            <div className="bg-red-50 rounded-lg p-2">
              <p className="text-lg font-bold text-red-700">{stats?.excluded_abstract || 0}</p>
              <p className="text-xs text-red-600">Excluded</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-2">
              <p className="text-lg font-bold text-amber-700">{stats?.maybe_abstract || 0}</p>
              <p className="text-xs text-amber-600">Maybe</p>
            </div>
          </div>
        </div>

        {/* Pie chart */}
        <div className="card p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Abstract Screening Distribution</h3>
          {abstractPieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={abstractPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
                  {abstractPieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip formatter={(val, name) => [val, name]} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
              No screening data yet
            </div>
          )}
          <div className="flex justify-center gap-4 mt-2">
            {abstractPieData.map(d => (
              <div key={d.name} className="flex items-center gap-1.5 text-xs text-gray-600">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                {d.name} ({d.value})
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Team activity */}
      {stats?.memberActivity?.length > 0 && (
        <div className="card p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Team Activity</h3>
          <div className="space-y-3">
            {stats.memberActivity.map((member: any, i: number) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-sm font-bold text-gray-400 w-5">#{i + 1}</span>
                <Avatar name={member.name} color={member.avatar_color} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900">{member.name}</span>
                    <span className="text-sm font-semibold text-brand-700">{member.decisions} decisions</span>
                  </div>
                  <ProgressBar value={member.decisions} max={Math.max(stats.memberActivity[0]?.decisions, 1)}
                    showLabel={false} size="sm" />
                </div>
                <div className="text-xs text-orange-500 flex items-center gap-0.5 w-12 justify-end">
                  {member.streak > 0 ? <><span>🔥</span>{member.streak}</> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept=".ris,.bib,.csv" className="hidden" onChange={handleImport} />
    </div>
  );
}
