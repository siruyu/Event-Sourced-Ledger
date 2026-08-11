import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { CreateAccountModal } from '@/components/forms/CreateAccountModal';
import { AccountsPage } from '@/pages/AccountsPage';
import { AccountDetailPage } from '@/pages/AccountDetailPage';

export function App() {
  const [creating, setCreating] = useState(false);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout onCreateAccount={() => setCreating(true)} />}>
          <Route index element={<AccountsPage onCreateAccount={() => setCreating(true)} />} />
          <Route path="accounts/:id" element={<AccountDetailPage />} />
        </Route>
      </Routes>
      {creating ? <CreateAccountModal onClose={() => setCreating(false)} /> : null}
    </BrowserRouter>
  );
}
