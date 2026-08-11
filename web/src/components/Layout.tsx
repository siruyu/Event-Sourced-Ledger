import { NavLink, Outlet, Link } from 'react-router-dom';
import { BookOpen, Landmark, Plus } from 'lucide-react';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`;

export function Layout({ onCreateAccount }: { onCreateAccount: () => void }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="border-b border-slate-200 bg-white lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center justify-between gap-3 px-4 lg:h-full lg:flex-col lg:items-stretch lg:px-4 lg:py-6">
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

        <nav aria-label="Primary" className="flex gap-1 px-4 pb-3 lg:flex-col lg:px-3 lg:pt-6">
          <NavLink to="/" end className={navLinkClass}>
            <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
            Accounts
          </NavLink>
        </nav>
      </aside>

      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
