import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import ReviewLayout from './components/layout/ReviewLayout';
import ReviewOverview from './pages/review/Overview';
import AbstractScreening from './pages/review/AbstractScreening';
import FulltextScreening from './pages/review/FulltextScreening';
import Duplicates from './pages/review/Duplicates';
import DataExtraction from './pages/review/DataExtraction';
import Team from './pages/review/Team';
import Conflicts from './pages/review/Conflicts';
import Leaderboard from './pages/review/Leaderboard';
import Settings from './pages/review/Settings';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

function GuestOnly({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  return !token ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
        <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/reviews/:reviewId" element={<RequireAuth><ReviewLayout /></RequireAuth>}>
          <Route index element={<ReviewOverview />} />
          <Route path="abstract" element={<AbstractScreening />} />
          <Route path="fulltext" element={<FulltextScreening />} />
          <Route path="duplicates" element={<Duplicates />} />
          <Route path="extraction" element={<DataExtraction />} />
          <Route path="team" element={<Team />} />
          <Route path="conflicts" element={<Conflicts />} />
          <Route path="leaderboard" element={<Leaderboard />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
