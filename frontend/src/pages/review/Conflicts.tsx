import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { screeningApi } from '../../api/client';
import Avatar from '../../components/common/Avatar';
import DecisionBadge from '../../components/common/DecisionBadge';
import { ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

export default function Conflicts() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const qc = useQueryClient();
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [finalDecision, setFinalDecision] = useState('');

  const { data: conflicts = [], refetch } = useQuery(
    ['conflicts', reviewId],
    () => screeningApi.conflicts(reviewId!).then(r => r.data),
    { enabled: !!reviewId }
  );

  const resolveMutation = useMutation(
    ({ conflictId, data }: { conflictId: string; data: any }) => screeningApi.resolveConflict(reviewId!, conflictId, data),
    {
      onSuccess: () => {
        refetch();
        qc.invalidateQueries(['stats', reviewId]);
        setResolving(null);
        setResolution('');
        setFinalDecision('');
        toast.success('Conflict resolved!');
      },
      onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to resolve')
    }
  );

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">Screening Conflicts</h2>
        <p className="text-sm text-gray-500 mt-0.5">Resolve disagreements between reviewers</p>
      </div>

      {conflicts.length === 0 ? (
        <div className="card p-16 text-center">
          <CheckCircleIcon className="w-16 h-16 text-emerald-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">No conflicts!</h3>
          <p className="text-gray-400">All screening decisions are in agreement</p>
        </div>
      ) : (
        <div className="space-y-4">
          {conflicts.map((conflict: any) => (
            <div key={conflict.id} className="card p-5 border-l-4 border-l-amber-400">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <ExclamationTriangleIcon className="w-5 h-5 text-amber-500" />
                  <span className="badge bg-amber-50 text-amber-700">{conflict.phase} phase</span>
                </div>
                <button onClick={() => setResolving(conflict.id)} className="btn-primary text-sm py-1.5">
                  Resolve
                </button>
              </div>

              <h3 className="font-semibold text-gray-900 mb-1">{conflict.title}</h3>
              <p className="text-sm text-gray-500 mb-4">
                {conflict.authors?.split(';')[0]} · {conflict.journal} · {conflict.year}
              </p>

              {conflict.abstract && (
                <p className="text-sm text-gray-600 mb-4 line-clamp-3 bg-gray-50 rounded-lg p-3">{conflict.abstract}</p>
              )}

              <div className="flex gap-3">
                {conflict.decisions.map((d: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                      style={{ backgroundColor: d.avatar_color || '#4F46E5' }}>
                      {d.name?.[0]?.toUpperCase()}
                    </div>
                    <span className="text-sm text-gray-700 font-medium">{d.name}</span>
                    <DecisionBadge decision={d.decision} size="sm" />
                    {d.reason && <span className="text-xs text-gray-400">"{d.reason}"</span>}
                  </div>
                ))}
              </div>

              {resolving === conflict.id && (
                <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                  <div>
                    <label className="label">Final Decision</label>
                    <div className="flex gap-2">
                      {['include', 'maybe', 'exclude'].map(d => (
                        <button key={d} onClick={() => setFinalDecision(d)}
                          className={`flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-colors ${finalDecision === d
                            ? d === 'include' ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                              : d === 'exclude' ? 'border-red-500 bg-red-50 text-red-700'
                                : 'border-amber-500 bg-amber-50 text-amber-700'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                          {d.charAt(0).toUpperCase() + d.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="label">Resolution Notes</label>
                    <textarea className="input resize-none h-16" placeholder="Explain the reasoning for this resolution..."
                      value={resolution} onChange={e => setResolution(e.target.value)} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setResolving(null)} className="btn-secondary text-sm">Cancel</button>
                    <button disabled={!finalDecision}
                      onClick={() => resolveMutation.mutate({ conflictId: conflict.id, data: { final_decision: finalDecision, resolution } })}
                      className="btn-primary text-sm">
                      Confirm Resolution
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
