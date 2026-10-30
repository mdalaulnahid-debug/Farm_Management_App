import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { useT } from './lib/i18n';
import { Empty, Loading } from './components/ui';
import Shell from './layout/Shell';
import Login, { ChangePassword } from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Sales = lazy(() => import('./pages/Sales'));
const Purchases = lazy(() => import('./pages/Purchases'));
const Parties = lazy(() => import('./pages/Parties'));
const Banking = lazy(() => import('./pages/Banking'));
const Production = lazy(() => import('./pages/Production'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Accounting = lazy(() => import('./pages/Accounting'));
const Reports = lazy(() => import('./pages/Reports'));
const Admin = lazy(() => import('./pages/Admin'));
const MyAccount = lazy(() => import('./pages/MyAccount'));

function Guard({ perm, children }: { perm: string | string[]; children: ReactNode }) {
  const { can } = useAuth();
  const t = useT();
  const perms = Array.isArray(perm) ? perm : [perm];
  if (!perms.some(can)) return <Empty>{t('Your role does not have access to this area. Ask the owner if you need it.', 'আপনার ভূমিকায় এই অংশে প্রবেশাধিকার নেই। প্রয়োজনে মালিককে জানান।')}</Empty>;
  return <>{children}</>;
}

export default function App() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <Login />;
  if (me.user.mustChangePassword) return <ChangePassword forced />;
  return (
    <Shell>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Guard perm="dashboard.view"><Dashboard /></Guard>} />
          <Route path="/sales" element={<Guard perm="sales.view"><Sales /></Guard>} />
          <Route path="/customers" element={<Guard perm="sales.view"><Parties kind="CUSTOMER" /></Guard>} />
          <Route path="/purchases" element={<Guard perm="purchases.view"><Purchases /></Guard>} />
          <Route path="/suppliers" element={<Guard perm="purchases.view"><Parties kind="SUPPLIER" /></Guard>} />
          <Route path="/banking" element={<Guard perm="banking.view"><Banking /></Guard>} />
          <Route path="/production" element={<Guard perm="production.view"><Production /></Guard>} />
          <Route path="/inventory" element={<Guard perm="inventory.view"><Inventory /></Guard>} />
          <Route path="/accounting" element={<Guard perm="accounting.view"><Accounting /></Guard>} />
          <Route path="/reports" element={<Guard perm="reports.view"><Reports /></Guard>} />
          <Route path="/admin" element={<Guard perm={['settings.manage', 'users.manage', 'audit.view']}><Admin /></Guard>} />
          <Route path="/account" element={<MyAccount />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}
