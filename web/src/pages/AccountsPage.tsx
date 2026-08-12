import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Plus } from 'lucide-react';
import { listAccounts, type AccountListParams } from '@/api/accounts';
import type { Account } from '@/api/types';
import { Badge, EmptyState, ErrorState, PageHeader, Select, Spinner } from '@/components/ui';
import { formatAmount } from '@/lib/format';
import { getSettings } from '@/lib/settings';

const statusTone: Record<Account['status'], 'success' | 'danger' | 'neutral'> = {
  active: 'success',
  frozen: 'danger',
  closed: 'neutral',
};

const ACCOUNT_TYPES = ['checking', 'savings', 'credit_card', 'cash', 'investment'] as const;

export function AccountsPage({ onCreateAccount }: { onCreateAccount: () => void }) {
  const [filters, setFilters] = useState<{ status?: Account['status']; type?: Account['type'] }>({});
  const [limit, setLimit] = useState(() => getSettings().pageSize);

  const params: AccountListParams = { limit, ...filters };
  const query = useQuery({
    queryKey: ['accounts', params],
    queryFn: () => listAccounts(params),
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  if (query.isError) {
    return <ErrorState message="Could not load accounts." onRetry={() => void query.refetch()} />;
  }

  const accounts = query.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader index="02" title="Accounts" meta="DERIVED BALANCES // IMMUTABLE LOG" />
        <button
          type="button"
          onClick={onCreateAccount}
          className="inline-flex min-h-[44px] items-center gap-2 bg-brand-600 px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.08em] text-black transition-colors hover:bg-brand-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New account
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span className="font-medium">Status</span>
          <Select
            value={filters.status ?? ''}
            onChange={(e) =>
              setFilters((f) => ({ ...f, status: (e.target.value || undefined) as Account['status'] | undefined }))
            }
            className="w-36"
            aria-label="Filter by status"
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="frozen">Frozen</option>
            <option value="closed">Closed</option>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span className="font-medium">Type</span>
          <Select
            value={filters.type ?? ''}
            onChange={(e) =>
              setFilters((f) => ({ ...f, type: (e.target.value || undefined) as Account['type'] | undefined }))
            }
            className="w-40"
            aria-label="Filter by type"
          >
            <option value="">All</option>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {accounts.length === 0 ? (
        <EmptyState title="No accounts match" hint="Adjust the filters or create an account." />
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-0 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.map((a) => (
              <li key={a.id}>
                <Link
                  to={`/accounts/${a.id}`}
                  className="group block t-panel p-4 transition-colors hover:border-brand-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-semibold uppercase tracking-wide text-slate-100">{a.name}</p>
                      <p className="truncate font-mono text-xs text-slate-500">{a.accountNumber}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-600 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <p className="text-lg font-semibold tabular text-slate-900 glow-readout">
                      {formatAmount(a.balance, a.currency)}
                    </p>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                      <Badge tone={statusTone[a.status]}>{a.status}</Badge>
                      <Badge tone="brand">{a.type}</Badge>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {query.data?.nextCursor ? (
            <div className="flex justify-center border-t border-slate-700 pt-4">
              <button
                type="button"
                onClick={() => setLimit((n) => n + 100)}
                className="inline-flex min-h-[44px] items-center px-4 font-mono text-xs font-semibold uppercase tracking-[0.08em] text-brand-600 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
              >
                {'>>>'} Load more
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
