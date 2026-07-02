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
const PropertyIntelligence = lazy(() => import('./pages/PropertyIntelligence'));
const Quotations = lazy(() => import('./pages/Quotations'));
const Invoicing = lazy(() => import('./pages/Invoicing'));
const Deals = lazy(() => import('./pages/Deals'));
const Ledger = lazy(() => import('./pages/Ledger'));
const Documents = lazy(() => import('./pages/Documents'));
const Team = lazy(() => import('./pages/Team'));
const Admin = lazy(() => import('./pages/Admin'));
const Cms = lazy(() => import('./pages/Cms'));
const PublicCms = lazy(() => import('./pages/PublicCms'));
const PublicPortal = lazy(() => import('./pages/PublicPortal'));
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

function SuperAdminOnly({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (user?.platformRole !== 'superadmin') return <Navigate to="/" replace />;
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
            <Route path="/portal/:kind/:token" element={<PublicPortal />} />
            <Route path="/read/:slug" element={<PublicCms />} />
            <Route path="/read/:slug/:contentSlug" element={<PublicCms />} />
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
              <Route path="/property-intelligence" element={<ModuleGate module="propertyIntel"><PropertyIntelligence /></ModuleGate>} />
              <Route path="/quotations" element={<ModuleGate module="quotations"><Quotations /></ModuleGate>} />
              <Route path="/invoicing" element={<ModuleGate module="invoicing"><Invoicing /></ModuleGate>} />
              <Route path="/deals" element={<ModuleGate module="deals"><Deals /></ModuleGate>} />
              <Route path="/ledger" element={<ModuleGate module="ledger"><Ledger /></ModuleGate>} />
              <Route path="/documents" element={<ModuleGate module="documents"><Documents /></ModuleGate>} />
              <Route path="/cms" element={<ModuleGate module="cms"><Cms /></ModuleGate>} />
              <Route path="/website" element={<ModuleGate module="website"><Website /></ModuleGate>} />
              <Route path="/team" element={<Team />} />
              <Route path="/admin" element={<SuperAdminOnly><Admin /></SuperAdminOnly>} />
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
