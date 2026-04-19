import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { reviewsApi } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import Avatar from '../../components/common/Avatar';
import { UserPlusIcon, TrashIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';

const ROLES = [
  { value: 'admin', label: 'Admin', description: 'Can manage articles, settings, and members', color: 'bg-violet-100 text-violet-700' },
  { value: 'reviewer', label: 'Reviewer', description: 'Can screen and extract data', color: 'bg-blue-100 text-blue-700' },
  { value: 'highlighter', label: 'Highlighter', description: 'Can highlight and comment only', color: 'bg-green-100 text-green-700' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only access', color: 'bg-gray-100 text-gray-600' },
];

export default function Team() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const user = useAuthStore(s => s.user);
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'reviewer' });

  const { data: members = [] } = useQuery(['members', reviewId], () => reviewsApi.members(reviewId!).then(r => r.data));
  const { data: review } = useQuery(['review', reviewId], () => reviewsApi.get(reviewId!).then(r => r.data));

  const inviteMutation = useMutation(
    (data: any) => reviewsApi.invite(reviewId!, data),
    {
      onSuccess: (res) => {
        qc.invalidateQueries(['members', reviewId]);
        setShowInvite(false);
        setInviteForm({ email: '', role: 'reviewer' });
        if (res.data.pending) {
          toast.success(`Invite created! Share this token: ${res.data.token}`);
        } else {
          toast.success(`${res.data.user?.name} added to review`);
        }
      },
      onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to invite')
    }
  );

  const removeMutation = useMutation(
    (userId: string) => reviewsApi.removeMember(reviewId!, userId),
    { onSuccess: () => { qc.invalidateQueries(['members', reviewId]); toast.success('Member removed'); } }
  );

  const roleColors: Record<string, string> = {
    owner: 'bg-brand-100 text-brand-700',
    admin: 'bg-violet-100 text-violet-700',
    reviewer: 'bg-blue-100 text-blue-700',
    highlighter: 'bg-green-100 text-green-700',
    viewer: 'bg-gray-100 text-gray-600',
  };

  const myRole = members.find((m: any) => m.user_id === user?.id)?.role;
  const canManage = ['owner', 'admin'].includes(myRole);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Team Members</h2>
          <p className="text-sm text-gray-500 mt-0.5">{members.length} member{members.length !== 1 ? 's' : ''}</p>
        </div>
        {canManage && (
          <button onClick={() => setShowInvite(true)} className="btn-primary">
            <UserPlusIcon className="w-4 h-4" />
            Invite Member
          </button>
        )}
      </div>

      {/* Blinding notice */}
      {review?.blinding_enabled && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <span className="text-2xl">🔒</span>
          <div>
            <p className="font-medium text-amber-800">Blinding is enabled</p>
            <p className="text-sm text-amber-600 mt-0.5">Reviewers cannot see each other's screening decisions. Results are revealed after consensus phase.</p>
          </div>
        </div>
      )}

      <div className="grid gap-3">
        {members.map((member: any) => (
          <div key={member.id} className="card p-4 flex items-center gap-4">
            <Avatar name={member.name} color={member.avatar_color} size="md" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-gray-900">{member.name}</p>
                {member.user_id === user?.id && <span className="text-xs text-gray-400">(you)</span>}
                <span className={`badge ${roleColors[member.role] || 'bg-gray-100 text-gray-600'}`}>
                  {member.role === 'owner' && <ShieldCheckIcon className="w-3 h-3 mr-1" />}
                  {member.role}
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-0.5">{member.email}</p>
              <div className="flex gap-4 mt-2 text-xs text-gray-400">
                <span>{member.decisions_made} decisions</span>
                <span>Joined {new Date(member.joined_at).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canManage && member.role !== 'owner' && member.user_id !== user?.id && (
                <>
                  <select className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700"
                    value={member.role}
                    onChange={async e => {
                      await reviewsApi.updateMemberRole(reviewId!, member.user_id, e.target.value);
                      qc.invalidateQueries(['members', reviewId]);
                      toast.success('Role updated');
                    }}>
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <button onClick={() => { if (confirm('Remove this member?')) removeMutation.mutate(member.user_id); }}
                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Roles explanation */}
      <div className="mt-8 card p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Role Permissions</h3>
        <div className="grid grid-cols-2 gap-3">
          {ROLES.map(role => (
            <div key={role.value} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
              <span className={`badge mt-0.5 ${role.color}`}>{role.label}</span>
              <p className="text-sm text-gray-600">{role.description}</p>
            </div>
          ))}
        </div>
      </div>

      {showInvite && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-semibold">Invite Team Member</h3>
              <button onClick={() => setShowInvite(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">Email address</label>
                <input className="input" type="email" placeholder="colleague@institution.edu"
                  value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} />
                <p className="text-xs text-gray-400 mt-1">If they don't have an account, an invite link will be generated</p>
              </div>
              <div>
                <label className="label">Role</label>
                <div className="space-y-2">
                  {ROLES.map(role => (
                    <label key={role.value} className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${inviteForm.role === role.value ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <input type="radio" name="role" value={role.value} checked={inviteForm.role === role.value}
                        onChange={() => setInviteForm(f => ({ ...f, role: role.value }))} className="mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{role.label}</p>
                        <p className="text-xs text-gray-500">{role.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowInvite(false)} className="btn-secondary">Cancel</button>
              <button onClick={() => { if (!inviteForm.email) return toast.error('Email required'); inviteMutation.mutate(inviteForm); }}
                disabled={inviteMutation.isLoading} className="btn-primary">
                {inviteMutation.isLoading ? 'Sending...' : 'Send Invite'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
