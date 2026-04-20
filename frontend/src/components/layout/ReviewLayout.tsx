import { Outlet, NavLink, useParams, useNavigate } from 'react-router-dom';
import { useQuery } from 'react-query';
import { useState } from 'react';
import { reviewsApi, authApi } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import { useThemeStore } from '../../store/theme';
import Avatar from '../common/Avatar';
import {
  HomeIcon, MagnifyingGlassIcon, DocumentTextIcon, DocumentDuplicateIcon,
  ClipboardDocumentListIcon, UsersIcon, ExclamationTriangleIcon,
  TrophyIcon, Cog6ToothIcon, BellIcon, ArrowLeftIcon, FireIcon,
  SunIcon, MoonIcon
} from '@heroicons/react/24/outline';

export default function ReviewLayout() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const { dark, toggle } = useThemeStore();
  const [notifOpen, setNotifOpen] = useState(false);

  const { data: review } = useQuery(['review', reviewId], () => reviewsApi.get(reviewId!).then(r => r.data), { enabled: !!reviewId });
  const { data: stats } = useQuery(['stats', reviewId], () => reviewsApi.stats(reviewId!).then(r => r.data), { enabled: !!reviewId, refetchInterval: 30000 });
  const { data: notifications } = useQuery('notifications', () => authApi.notifications().then(r => r.data), { refetchInterval: 15000 });

  const unreadCount = notifications?.filter((n: any) => !n.read).length || 0;

  const navItems = [
    { to: `/reviews/${reviewId}`, icon: HomeIcon, label: 'Overview', end: true },
    { to: `/reviews/${reviewId}/abstract`, icon: MagnifyingGlassIcon, label: 'Abstract Screening' },
    { to: `/reviews/${reviewId}/fulltext`, icon: DocumentTextIcon, label: 'Full-Text Screening' },
    { to: `/reviews/${reviewId}/duplicates`, icon: DocumentDuplicateIcon, label: 'Duplicates' },
    { to: `/reviews/${reviewId}/extraction`, icon: ClipboardDocumentListIcon, label: 'Data Extraction' },
    { to: `/reviews/${reviewId}/conflicts`, icon: ExclamationTriangleIcon, label: 'Conflicts', badge: stats?.conflicts || 0 },
    { to: `/reviews/${reviewId}/team`, icon: UsersIcon, label: 'Team' },
    { to: `/reviews/${reviewId}/leaderboard`, icon: TrophyIcon, label: 'Leaderboard' },
    { to: `/reviews/${reviewId}/settings`, icon: Cog6ToothIcon, label: 'Settings' },
  ];

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <button onClick={() => navigate('/')} className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 text-sm mb-3 transition-colors">
            <ArrowLeftIcon className="w-4 h-4" /><span>All Reviews</span>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-gray-400 leading-none">Review</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate leading-tight mt-0.5">{review?.title || '...'}</p>
            </div>
          </div>
          {review?.blinding_enabled ? (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-md">
              <span>🔒</span> Blinding enabled
            </div>
          ) : null}
        </div>

        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label, end, badge }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
                }`
              }>
              <Icon className="w-5 h-5 flex-shrink-0" />
              <span className="flex-1">{label}</span>
              {badge ? <span className="bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 text-xs font-bold px-1.5 py-0.5 rounded-full">{badge}</span> : null}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar name={user?.name || ''} color={user?.avatar_color} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{user?.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-brand-600 dark:text-brand-400 font-medium">{user?.points || 0} pts</span>
                {(user?.streak || 0) > 0 && (
                  <span className="flex items-center gap-0.5 text-xs text-orange-500 font-medium">
                    <FireIcon className="w-3 h-3" />{user?.streak}
                  </span>
                )}
              </div>
            </div>
            {/* Dark mode toggle */}
            <button onClick={toggle} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title="Toggle dark mode">
              {dark ? <SunIcon className="w-4 h-4 text-amber-400" /> : <MoonIcon className="w-4 h-4 text-gray-500" />}
            </button>
            {/* Notifications */}
            <div className="relative">
              <button onClick={() => setNotifOpen(o => !o)} className="relative p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <BellIcon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute bottom-full right-0 mb-2 w-72 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 z-50 max-h-80 overflow-y-auto">
                  <div className="p-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                    <span className="text-sm font-semibold dark:text-gray-100">Notifications</span>
                    <button onClick={() => setNotifOpen(false)} className="text-xs text-brand-600 hover:text-brand-700">Close</button>
                  </div>
                  {!notifications?.length ? (
                    <p className="p-4 text-sm text-gray-400 text-center">No notifications</p>
                  ) : notifications.map((n: any) => (
                    <div key={n.id} className={`p-3 border-b border-gray-50 dark:border-gray-800 text-sm ${!n.read ? 'bg-brand-50 dark:bg-brand-900/20' : ''}`}>
                      <p className="text-gray-800 dark:text-gray-200">{n.message}</p>
                      <p className="text-xs text-gray-400 mt-1">{new Date(n.created_at).toLocaleDateString()}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button onClick={() => { logout(); navigate('/login'); }}
            className="mt-1 w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors">
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden flex flex-col">
        <Outlet />
      </main>
    </div>
  );
}
