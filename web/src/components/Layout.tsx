import { NavLink, Outlet, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { BookOpen, KeyRound, Landmark, Plus } from 'lucide-react';
import { getApiKey, setApiKey } from '@/api/client';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`;

export function Layout({ onCreateAccount }: { onCreateAccount: () => void }) {
  const [apiKey, setApiKeyState] = useState(getApiKey());

  useEffect(() => {
    setApiKey(apiKey);
  }, [apiKey]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="flex flex-col border-b border-slate-200 bg-white lg:min-h-dvh lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center justify-between gap-3 px-4 lg:h-auto lg:items-center lg:justify-between lg:px-4 lg:py-6">
          <Link to="/" className="flex items-center gap-2.5 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Landmark className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-base font-semibold tracking-tight text-slate-900">Ledger Console</span>
          </Link>

          <button
            type="button"
            onClick={onCreateAccount}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">New account</span>
            <span className="sr-only sm:hidden">New account</span>
          </button>
        </div>

        <nav aria-label="Primary" className="flex gap-1 px-4 pb-3 lg:flex-col lg:px-3 lg:pt-2">
          <NavLink to="/" end className={navLinkClass}>
            <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
            Accounts
          </NavLink>
        </nav>

        <div className="mt-auto hidden border-t border-slate-100 px-4 py-4 lg:block">
          <label htmlFor="api-key" className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
            API key
          </label>
          <input
            id="api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKeyState(e.target.value)}
            placeholder="Optional — for keyed APIs"
            autoComplete="off"
            className="mt-1.5 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
          <p className="mt-1 text-[11px] text-slate-400">Sent as x-api-key on every request (session only).</p>
        </div>
      </aside>

      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
