import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { getTransactionByReference, getTransactionsFeed } from '@/api/accounts';
import type { FeedTransaction, Transaction } from '@/api/types';
import { ApiError } from '@/api/client';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Select, Spinner } from '@/components/ui';
import { TransactionDetailModal } from '@/components/TransactionDetailModal';
import { formatAmount, formatDateTime } from '@/lib/format';
import { getSettings } from '@/lib/settings';

const txTone: Record<string, string> = {
  deposit: 'border-emerald-500/50 text-emerald-500',
  withdrawal: 'border-rose-500/50 text-rose-500',
  transfer: 'border-brand-600 text-slate-200',
  reversal: 'border-amber-500/50 text-amber-500',
  fee: 'border-slate-600 text-slate-500',
};

export function ActivityPage() {
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [refQuery, setRefQuery] = useState('');
  const [refValue, setRefValue] = useState('');

  const feedQuery = useQuery({
    queryKey: ['feed', { type, status, cursor }],
    queryFn: () => getTransactionsFeed({ type: type || undefined, status: status || undefined, cursor, limit: getSettings().pageSize }),
  });

  const refResult = useQuery({
    queryKey: ['transaction-by-ref', refQuery],
    queryFn: () => getTransactionByReference(refQuery),
    enabled: Boolean(refQuery),
  });

  const items = feedQuery.data?.items ?? [];

  const filtered = items;

  const submitRef = () => {
    const q = refValue.trim();
    if (!q) return;
    setRefQuery(q);
  };

  const openRef = (tx: Transaction) => setSelected(tx.id);

  return (
    <div className="space-y-6">
      <PageHeader index="03" title="Activity" meta="GLOBAL FEED // NEWEST FIRST" />

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span className="font-medium">Type</span>
            <Select value={type} onChange={(e) => { setType(e.target.value); setCursor(undefined); }} className="w-36" aria-label="Filter by type">
              <option value="">All</option>
              <option value="deposit">Deposit</option>
              <option value="withdrawal">Withdrawal</option>
              <option value="transfer">Transfer</option>
              <option value="reversal">Reversal</option>
              <option value="fee">Fee</option>
            </Select>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span className="font-medium">Status</span>
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setCursor(undefined); }} className="w-32" aria-label="Filter by status">
              <option value="">All</option>
              <option value="posted">Posted</option>
              <option value="void">Void</option>
            </Select>
          </label>
        </div>

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); submitRef(); }}
        >
          <label htmlFor="ref-search" className="sr-only">
            Search by reference
          </label>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Search className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
            <input
              id="ref-search"
              value={refValue}
              onChange={(e) => setRefValue(e.target.value)}
              placeholder="Lookup a transaction by idempotency reference…"
              className="min-h-[44px] w-full border border-slate-600 bg-black/40 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600/40"
            />
          </div>
          <Button type="submit">Find</Button>
        </form>

        {refResult.isPending ? <Spinner className="h-5 w-5 text-brand-600" /> : null}
        {refResult.isError ? (
          <p className="font-mono text-sm uppercase tracking-wide text-rose-500" role="alert">
            {refResult.error instanceof ApiError ? refResult.error.message : 'No transaction for that reference.'}
          </p>
        ) : null}
        {refResult.data ? (
          <button type="button" onClick={() => openRef(refResult.data)} className="w-full text-left">
            <div className="flex flex-wrap items-center justify-between gap-2 border border-brand-600/50 bg-brand-50/40 px-3 py-2 text-sm">
              <span>
                <span className={`mr-2 inline-flex items-center border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${txTone[refResult.data.type] ?? txTone.fee}`}>
                  {refResult.data.type}
                </span>
                <span className="font-mono text-xs text-slate-300">{refResult.data.reference}</span>
              </span>
              <span className="text-xs text-slate-500">Tap to open {'>>>'}</span>
            </div>
          </button>
        ) : null}
      </Card>

      <Card className="p-5">
        <h2 className="macro-section">Transactions</h2>

        <div className="mt-3">
          {feedQuery.isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-6 w-6 text-brand-600" />
            </div>
          ) : feedQuery.isError ? (
            <ErrorState message="Could not load the activity feed." onRetry={() => void feedQuery.refetch()} />
          ) : filtered.length === 0 ? (
            <EmptyState title="No transactions match" hint="Adjust the filters or make a deposit/transfer." />
          ) : (
            <ul className="divide-y divide-slate-200">
              {filtered.map((t: FeedTransaction) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(t.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`inline-flex items-center border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${txTone[t.type] ?? txTone.fee}`}>
                        {t.type}
                      </span>
                      <span className="truncate text-sm font-medium text-slate-900">
                        {t.legs.length >= 2
                          ? `${t.legs[0].accountName} → ${t.legs[t.legs.length - 1].accountName}`
                          : t.legs[0]?.accountName ?? '—'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      {t.legs[0] ? (
                        <span className="tabular text-slate-500">{formatAmount(t.legs[0].amount, t.legs[0].currency)}</span>
                      ) : null}
                      <Badge tone={t.status === 'posted' ? 'success' : 'neutral'}>{t.status}</Badge>
                      <span className="tabular text-xs text-slate-500">{formatDateTime(t.postedAt)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {feedQuery.data?.nextCursor ? (
          <div className="flex justify-center border-t border-slate-700 pt-4">
            <Button variant="secondary" onClick={() => setCursor(feedQuery.data!.nextCursor)}>
              {'>>>'} Load more
            </Button>
          </div>
        ) : null}
      </Card>

      {selected ? <TransactionDetailModal transactionId={selected} onClose={() => setSelected(undefined)} /> : null}
    </div>
  );
}