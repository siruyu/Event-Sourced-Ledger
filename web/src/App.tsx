import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { CreateAccountModal } from '@/components/forms/CreateAccountModal';
import { AccountsPage } from '@/pages/AccountsPage';
import { AccountDetailPage } from '@/pages/AccountDetailPage';
import { ActivityPage } from '@/pages/ActivityPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { SettingsPage } from '@/pages/SettingsPage';

export function App() {
  const [creating, setCreating] = useState(false);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout onCreateAccount={() => setCreating(true)} />}>
          <Route index element={<DashboardPage />} />
          <Route path="accounts" element={<AccountsPage onCreateAccount={() => setCreating(true)} />} />
          <Route path="accounts/:id" element={<AccountDetailPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      {creating ? <CreateAccountModal onClose={() => setCreating(false)} /> : null}
    </BrowserRouter>
  );
}
