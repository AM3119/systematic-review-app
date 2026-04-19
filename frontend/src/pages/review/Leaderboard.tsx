import { useParams } from 'react-router-dom';
import { useQuery } from 'react-query';
import { reviewsApi } from '../../api/client';
import { useAuthStore } from '../../store/auth';
import Avatar from '../../components/common/Avatar';
import { TrophyIcon, FireIcon, StarIcon } from '@heroicons/react/24/outline';
import { TrophyIcon as TrophySolid } from '@heroicons/react/24/solid';

const BADGE_DEFINITIONS: Record<string, { icon: string; color: string }> = {
  first_screen: { icon: '🎯', color: 'bg-blue-100' },
  speed_screener: { icon: '⚡', color: 'bg-yellow-100' },
  expert_screener: { icon: '🔬', color: 'bg-purple-100' },
  fulltext_hero: { icon: '📚', color: 'bg-green-100' },
  data_extractor: { icon: '📊', color: 'bg-teal-100' },
  duplicate_hunter: { icon: '🕵️', color: 'bg-orange-100' },
  week_streak: { icon: '🔥', color: 'bg-red-100' },
  month_streak: { icon: '💫', color: 'bg-pink-100' },
  conflict_resolver: { icon: '⚖️', color: 'bg-indigo-100' },
  century_club: { icon: '💯', color: 'bg-amber-100' },
  thousand_club: { icon: '🏆', color: 'bg-gold-100' },
};

const podiumColors = ['text-amber-500', 'text-gray-400', 'text-amber-700'];
const podiumBg = ['bg-amber-50 border-amber-200', 'bg-gray-50 border-gray-200', 'bg-orange-50 border-orange-200'];

export default function Leaderboard() {
  const { reviewId } = useParams<{ reviewId: string }>();
  const user = useAuthStore(s => s.user);

  const { data: leaders = [] } = useQuery(['leaderboard', reviewId], () => reviewsApi.leaderboard(reviewId!).then(r => r.data));
  const { data: badges = [] } = useQuery(['badges', reviewId], () => reviewsApi.badges(reviewId!).then(r => r.data));

  const top3 = leaders.slice(0, 3);
  const rest = leaders.slice(3);

  const myBadges = badges.filter((b: any) => b.user_id === user?.id);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">🏆 Leaderboard</h2>
        <p className="text-sm text-gray-500 mt-0.5">See how you rank against your team</p>
      </div>

      {/* Podium */}
      {top3.length >= 1 && (
        <div className="card p-6 mb-6 bg-gradient-to-b from-brand-50 to-white">
          <div className="flex items-end justify-center gap-4 mb-6">
            {[top3[1], top3[0], top3[2]].filter(Boolean).map((leader: any, podiumPos: number) => {
              const rank = podiumPos === 0 ? 2 : podiumPos === 1 ? 1 : 3;
              const heights = ['h-24', 'h-32', 'h-20'];
              return (
                <div key={leader.id} className={`flex flex-col items-center gap-2 ${podiumPos === 1 ? 'order-2' : podiumPos === 0 ? 'order-1' : 'order-3'}`}>
                  {rank === 1 && <span className="text-2xl animate-bounce-in">👑</span>}
                  <Avatar name={leader.name} color={leader.avatar_color} size={rank === 1 ? 'lg' : 'md'} />
                  <p className="text-sm font-semibold text-gray-900 text-center">{leader.name.split(' ')[0]}</p>
                  <div className={`w-24 ${heights[podiumPos]} ${podiumBg[rank - 1]} border rounded-t-xl flex flex-col items-center justify-center`}>
                    <TrophySolid className={`w-6 h-6 ${podiumColors[rank - 1]}`} />
                    <span className="text-lg font-bold text-gray-800">#{rank}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-center text-sm text-gray-500">Points = Abstracts×1 + Full-texts×2 + Extractions×4</div>
        </div>
      )}

      {/* Full rankings */}
      <div className="card mb-6">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Full Rankings</h3>
        </div>
        <div className="divide-y divide-gray-50">
          {leaders.map((leader: any, i: number) => {
            const isMe = leader.id === user?.id;
            const score = leader.abstracts + leader.fulltexts * 2 + leader.extractions * 4;
            return (
              <div key={leader.id} className={`flex items-center gap-4 p-4 ${isMe ? 'bg-brand-50' : 'hover:bg-gray-50'} transition-colors`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${
                  i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-gray-100 text-gray-600' : i === 2 ? 'bg-orange-100 text-orange-600' : 'bg-gray-50 text-gray-500'
                }`}>
                  {i + 1}
                </div>
                <Avatar name={leader.name} color={leader.avatar_color} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900 truncate">{leader.name}{isMe && <span className="text-xs text-gray-400 ml-1">(you)</span>}</p>
                    {leader.streak > 0 && (
                      <span className="flex items-center gap-0.5 text-xs text-orange-500 font-medium">
                        <FireIcon className="w-3 h-3" />{leader.streak}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3 text-xs text-gray-400 mt-0.5">
                    <span>📋 {leader.abstracts} abstracts</span>
                    <span>📄 {leader.fulltexts} full-texts</span>
                    <span>📊 {leader.extractions} extractions</span>
                    <span>🏅 {leader.badge_count} badges</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-bold text-brand-700 text-lg">{score}</p>
                  <p className="text-xs text-gray-400">points</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* My badges */}
      <div className="card p-5">
        <h3 className="font-semibold text-gray-900 mb-4">Your Badges ({myBadges.length})</h3>
        {myBadges.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <StarIcon className="w-12 h-12 mx-auto mb-2 text-gray-200" />
            <p>Start screening to earn badges!</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {myBadges.map((badge: any) => {
              const def = BADGE_DEFINITIONS[badge.badge_type] || { icon: '🏅', color: 'bg-gray-100' };
              return (
                <div key={badge.id} className={`${def.color} rounded-xl p-4 text-center animate-bounce-in`}>
                  <span className="text-3xl">{def.icon}</span>
                  <p className="text-sm font-semibold text-gray-800 mt-2">{badge.badge_name}</p>
                  <p className="text-xs text-gray-500 mt-1">{badge.description}</p>
                  <p className="text-xs text-gray-400 mt-2">{new Date(badge.earned_at).toLocaleDateString()}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* All possible badges */}
        <div className="mt-6 pt-4 border-t border-gray-100">
          <p className="text-sm font-medium text-gray-700 mb-3">All Available Badges</p>
          <div className="grid grid-cols-4 gap-2">
            {Object.entries(BADGE_DEFINITIONS).map(([type, def]) => {
              const earned = myBadges.find((b: any) => b.badge_type === type);
              return (
                <div key={type} className={`rounded-lg p-2 text-center ${earned ? def.color : 'bg-gray-50 opacity-40'}`}>
                  <span className="text-xl">{def.icon}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
