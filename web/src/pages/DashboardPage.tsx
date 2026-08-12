import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Landmark, Star, Wallet } from 'lucide-react';
import { getTransactionsFeed, listAccounts } from '@/api/accounts';
import { Badge, Card, ErrorState, PageHeader, Spinner } from '@/components/ui';
import { formatAmount, formatDateTime } from '@/lib/format';
import { getSettings } from '@/lib/settings';

const statusTone: Record<string, 'success' | 'danger' | 'neutral'> = {
  active: 'success',
  frozen: 'danger',
  closed: 'neutral',
};

const txTone: Record<string, string> = {
  deposit: 'border-emerald-500/50 text-emerald-500',
  withdrawal: 'border-rose-500/50 text-rose-500',
  transfer: 'border-brand-600 text-slate-200',
  reversal: 'border-amber-500/50 text-amber-500',
  fee: 'border-slate-600 text-slate-500',
};

export function DashboardPage() {
  const accountsQuery = useQuery({ queryKey: ['accounts', { limit: 100 }], queryFn: () => listAccounts({ limit: 100 }) });
  const feedQuery = useQuery({ queryKey: ['feed', 'dashboard'], queryFn: () => getTransactionsFeed({ limit: 8 }) });

  const stats = useMemo(() => {
    const items = accountsQuery.data?.items ?? [];
    const byCurrency = new Map<string, { balance: number; count: number }>();
    const byStatus: Record<string, number> = { active: 0, frozen: 0, closed: 0 };
    const byType = new Map<string, number>();
    for (const a of items) {
      const cur = byCurrency.get(a.currency) ?? { balance: 0, count: 0 };
      cur.balance += Number(a.balance);
      cur.count += 1;
      byCurrency.set(a.currency, cur);
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
      byType.set(a.type, (byType.get(a.type) ?? 0) + 1);
    }
    return { byCurrency, byStatus, byType, total: items.length };
  }, [accountsQuery.data]);

  if (accountsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  if (accountsQuery.isError) {
    return <ErrorState message="Could not load the dashboard." onRetry={() => void accountsQuery.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        index="01"
        title="Dashboard"
        meta="LIVE VIEW // EVENT-SOURCED LEDGER"
      />

      <div className="t-grid-lines grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="tech-label">Accounts</p>
          <p className="mt-1 text-2xl font-semibold tabular text-slate-900 glow-readout">{stats.total}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {Object.entries(stats.byStatus)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => `${k} ${n}`)
              .join(' · ') || 'none'}
          </p>
        </Card>

        <Card className="p-4">
          <p className="tech-label">Balances by currency</p>
          <ul className="mt-1 space-y-1">
            {[...stats.byCurrency.entries()]
              .sort(([a], [b]) => {
                const match = (c: string) => c === getSettings().displayCurrency;
                return Number(match(b)) - Number(match(a));
              })
              .map(([cur, v]) => (
                <li key={cur} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5">
                    {cur === getSettings().displayCurrency ? (
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Preferred currency" />
                    ) : null}
                    <span className="font-semibold text-slate-900">{formatAmount(String(v.balance), cur)}</span>
                  </span>
                  <span className="text-xs text-slate-500">{v.count} account{v.count === 1 ? '' : 's'}</span>
                </li>
              ))}
          </ul>
        </Card>

        <Card className="p-4">
          <p className="tech-label">By type</p>
          <ul className="mt-1 space-y-1">
            {[...stats.byType.entries()].map(([t, n]) => (
              <li key={t} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-700">{t}</span>
                <span className="tabular text-slate-900">{n}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-4">
          <p className="tech-label">Attention needed</p>
          <p className="mt-1 text-2xl font-semibold tabular text-slate-900 glow-red">
            {(stats.byStatus.frozen ?? 0) + (stats.byStatus.closed ?? 0)}
          </p>
          <Link
            to="/accounts?status=frozen"
            className="mt-1 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            View frozen / closed <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 macro-section">
            <Landmark className="h-4 w-4 text-slate-400" aria-hidden="true" />
            Recent activity
          </h2>
          <Link
            to="/activity"
            className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            View all <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <div className="mt-3">
          {feedQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          ) : feedQuery.isError ? (
            <ErrorState message="Could not load recent activity." onRetry={() => void feedQuery.refetch()} />
          ) : feedQuery.data && feedQuery.data.items.length > 0 ? (
            <ul className="divide-y divide-slate-200">
              {feedQuery.data.items.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`inline-flex items-center border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${txTone[t.type] ?? txTone.fee}`}>
                      {t.type}
                    </span>
                    <span className="truncate text-sm text-slate-700">
                      {t.legs[0] ? `${t.legs[0].accountName} → ${t.legs[1]?.accountName ?? '…'}` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Badge tone={statusTone[t.status] ?? 'neutral'}>{t.status}</Badge>
                    <span className="tabular text-slate-500">{formatDateTime(t.postedAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 border border-slate-600 bg-slate-50 px-3 py-4 text-sm text-slate-500">
              <Wallet className="h-4 w-4" aria-hidden="true" />
              No activity yet — make a deposit or transfer to see it here.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
