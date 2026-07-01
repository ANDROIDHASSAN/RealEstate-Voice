import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ModuleGate } from './components/layout/ModuleGate';
import { Shell } from './components/layout/Shell';
import { PageSkeleton } from './components/ui/skeleton';
import { useAuthStore } from './store/auth';

const Login = lazy(() => import('./pages/Login'));
const Signup = lazy(() => import('./pages/Signup'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Leads = lazy(() => import('./pages/Leads'));
const Voice = lazy(() => import('./pages/Voice'));
const Followup = lazy(() => import('./pages/Followup'));
const Inbox = lazy(() => import('./pages/Inbox'));
const LeadEngine = lazy(() => import('./pages/LeadEngine'));
const Content = lazy(() => import('./pages/Content'));
const Agents = lazy(() => import('./pages/Agents'));
const Website = lazy(() => import('./pages/Website'));
const Billing = lazy(() => import('./pages/Billing'));
const Settings = lazy(() => import('./pages/Settings'));
const PublicSite = lazy(() => import('./pages/PublicSite'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});

function Protected({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<div className="p-10"><PageSkeleton /></div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/site/:slug" element={<PublicSite />} />
            <Route
              element={
                <Protected>
                  <Shell />
                </Protected>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/leads" element={<ModuleGate module="instantReply"><Leads /></ModuleGate>} />
              <Route path="/voice" element={<ModuleGate module="voice"><Voice /></ModuleGate>} />
              <Route path="/followup" element={<ModuleGate module="followup"><Followup /></ModuleGate>} />
              <Route path="/inbox" element={<Inbox />} />
              <Route path="/lead-engine" element={<ModuleGate module="leadEngine"><LeadEngine /></ModuleGate>} />
              <Route path="/content" element={<ModuleGate module="content"><Content /></ModuleGate>} />
              <Route path="/agents" element={<ModuleGate module="multiAgent"><Agents /></ModuleGate>} />
              <Route path="/website" element={<ModuleGate module="website"><Website /></ModuleGate>} />
              <Route path="/billing" element={<Billing />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
