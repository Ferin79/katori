import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { AddMeal } from './pages/AddMeal';
import { Home } from './pages/Home';
import { Onboarding } from './pages/Onboarding';
import { Review } from './pages/Review';
import { useProfiles } from './profile';

// Home, Add meal and Review are in the main bundle; the rest load on first visit.
const Body = lazy(() => import('./pages/Body').then((m) => ({ default: m.Body })));
const Progress = lazy(() => import('./pages/Progress').then((m) => ({ default: m.Progress })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const EditProfile = lazy(() => import('./pages/EditProfile').then((m) => ({ default: m.EditProfile })));
const Foods = lazy(() => import('./pages/Foods').then((m) => ({ default: m.Foods })));
const Calibration = lazy(() => import('./pages/Calibration').then((m) => ({ default: m.Calibration })));

export function App() {
  const { profiles, loading } = useProfiles();
  if (loading) return <Loading />;
  const none = profiles.length === 0;

  // One route tree, so onboarding stays mounted while its new profile appears in the list.
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/onboarding" element={<Onboarding first={none} />} />
        <Route element={none ? <Navigate to="/onboarding" replace /> : <Layout />}>
          <Route index element={<Home />} />
          <Route path="add" element={<AddMeal />} />
          <Route path="meal/:id" element={<Review />} />
          <Route path="body" element={<Body />} />
          <Route path="progress" element={<Progress />} />
          <Route path="settings" element={<Settings />} />
          <Route path="settings/profile" element={<EditProfile />} />
          <Route path="settings/foods" element={<Foods />} />
          <Route path="settings/calibration" element={<Calibration />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
