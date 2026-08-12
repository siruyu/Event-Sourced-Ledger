import { NavLink, Outlet, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { BookOpen, FileText, Gauge, History, KeyRound, Landmark, Plus, Settings, ShieldCheck } from 'lucide-react';
import { getApiKey, setApiKey } from '@/api/client';
import { getRecentAccounts } from '@/lib/recent';
import { ThemeToggle } from '@/components/ThemeToggle';

const navItems = [
  { to: '/', end: true, icon: Gauge, label: 'Dashboard' },
  { to: '/accounts', end: false, icon: BookOpen, label: 'Accounts' },
  { to: '/activity', end: false, icon: History, label: 'Activity' },
  { to: '/reports', end: false, icon: FileText, label: 'Reports' },
  { to: '/settings', end: false, icon: Settings, label: 'Settings' },
];

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-[44px] items-center gap-3 border-l-2 px-3 py-2 font-mono text-xs font-semibold uppercase tracking-[0.08em] transition-colors ${
    isActive
      ? 'border-brand-600 bg-brand-50/60 text-brand-600'
      : 'border-transparent text-slate-500 hover:border-slate-600 hover:bg-slate-100/40 hover:text-slate-200'
  }`;

export function Layout({ onCreateAccount }: { onCreateAccount: () => void }) {
  const [apiKey, setApiKeyState] = useState(getApiKey());
  const [recents, setRecents] = useState(() => getRecentAccounts());

  useEffect(() => {
    setApiKey(apiKey);
  }, [apiKey]);

  // Refresh recently-viewed when navigating back to the shell.
  useEffect(() => {
    const onFocus = () => setRecents(getRecentAccounts());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  return (
    <div className="min-h-dvh lg:h-dvh lg:grid lg:grid-cols-[17rem_1fr] lg:overflow-hidden">
      <aside className="flex flex-col border-b border-slate-700 bg-black/20 lg:h-full lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center justify-between gap-3 px-4 lg:h-auto lg:items-start lg:justify-between lg:px-5 lg:py-6">
          <Link
            to="/"
            className="group flex items-center gap-2.5 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            <span className="flex h-9 w-9 items-center justify-center bg-brand-600 text-black">
              <Landmark className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />
            </span>
            <span className="font-mono text-sm font-bold uppercase leading-tight tracking-[0.12em] text-slate-100">
              Ledger
              <span className="block text-[10px] font-medium text-slate-500">// console</span>
            </span>
          </Link>

          <button
            type="button"
            onClick={onCreateAccount}
            className="inline-flex min-h-[44px] items-center gap-2 bg-brand-600 px-3 py-2 font-mono text-xs font-semibold uppercase tracking-[0.08em] text-black transition-colors hover:bg-brand-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">New account</span>
            <span className="sr-only sm:hidden">New account</span>
          </button>
        </div>

        <nav aria-label="Primary" className="flex gap-0.5 overflow-x-auto px-4 pb-3 lg:flex-col lg:overflow-visible lg:px-3 lg:pt-2">
          {navItems.map(({ to, end, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={end} className={navLinkClass}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>

        {recents.length > 0 ? (
          <div className="mt-2 hidden px-3 lg:block">
            <p className="tech-label px-3">
              <span className="text-brand-600">{'>'}</span> Recent access
            </p>
            <ul className="mt-1">
              {recents.map((a) => (
                <li key={a.id}>
                  <NavLink
                    to={`/accounts/${a.id}`}
                    className="flex min-h-[44px] items-center gap-3 border-l-2 border-transparent px-3 py-2 font-mono text-xs text-slate-500 transition-colors hover:border-slate-600 hover:bg-slate-100/40 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                  >
                    <span className="truncate">{a.name}</span>
                    <span className="ml-auto truncate text-[10px] text-slate-600">{a.accountNumber}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-auto space-y-1 border-t border-slate-700 px-3 py-4 lg:mt-0">
          <ThemeToggle />
          <Link
            to="/docs"
            target="_blank"
            rel="noreferrer"
            className="flex min-h-[44px] items-center gap-3 border-l-2 border-transparent px-3 py-2 font-mono text-xs font-semibold uppercase tracking-[0.08em] text-slate-500 transition-colors hover:border-slate-600 hover:bg-slate-100/40 hover:text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            API docs (Swagger)
          </Link>
          <label htmlFor="api-key" className="flex items-center gap-1.5 px-3 pt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
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
            className="mt-1 min-h-[44px] w-full border border-slate-600 bg-black/40 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600/40"
          />
          <p className="px-3 pt-1 text-[10px] text-slate-600">Sent as x-api-key on every request (session only).</p>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:h-full lg:px-10 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
