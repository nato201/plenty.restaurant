import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { isStaffHost } from './utils/staffHost.ts';
import './index.css';

// The staff portal is its own bundle, only downloaded on the staff subdomain
// (e.g. admin.plenty.restaurant). The public site never ships or links to it.
const StaffApp = lazy(() => import('./staff/StaffApp.tsx'));

createRoot(document.getElementById('root')!).render(
  isStaffHost() ? (
    <Suspense fallback={<div className="min-h-screen bg-ink" />}>
      <StaffApp />
    </Suspense>
  ) : (
    <App />
  )
);
