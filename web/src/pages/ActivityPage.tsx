import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { getTransactionByReference, getTransactionsFeed } from '@/api/accounts';
import type { FeedTransaction, Transaction } from '@/api/types';
import { ApiError } from '@/api/client';
import { Badge, Button, Card, EmptyState, ErrorState, Select, Spinner } from '@/components/ui';
import { TransactionDetailModal } from '@/components/TransactionDetailModal';
import { formatAmount, formatDateTime } from '@/lib/format';
import { getSettings } from '@/lib/settings';

const txTone: Record<string, string> = {
  deposit: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  withdrawal: 'bg-rose-50 text-rose-700 ring-rose-200',
  transfer: 'bg-brand-50 text-brand-700 ring-brand-200',
  reversal: 'bg-amber-50 text-amber-700 ring-amber-200',
  fee: 'bg-slate-100 text-slate-700 ring-slate-200',
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Activity</h1>
        <p className="mt-1 text-sm text-slate-500">Every transaction across all accounts, newest first.</p>
      </div>

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
            <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <input
              id="ref-search"
              value={refValue}
              onChange={(e) => setRefValue(e.target.value)}
              placeholder="Lookup a transaction by idempotency reference…"
              className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <Button type="submit">Find</Button>
        </form>

        {refResult.isPending ? <Spinner className="h-5 w-5 text-brand-600" /> : null}
        {refResult.isError ? (
          <p className="text-sm text-rose-700" role="alert">
            {refResult.error instanceof ApiError ? refResult.error.message : 'No transaction for that reference.'}
          </p>
        ) : null}
        {refResult.data ? (
          <button type="button" onClick={() => openRef(refResult.data)} className="w-full text-left">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span>
                <span className={`mr-2 inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${txTone[refResult.data.type] ?? txTone.fee}`}>
                  {refResult.data.type}
                </span>
                {refResult.data.reference}
              </span>
              <span className="text-xs text-slate-500">Tap to open</span>
            </div>
          </button>
        ) : null}
      </Card>

      <Card className="p-5">
        <h2 className="text-base font-semibold text-slate-900">Transactions</h2>

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
            <ul className="divide-y divide-slate-100">
              {filtered.map((t: FeedTransaction) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(t.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${txTone[t.type] ?? txTone.fee}`}>
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
                        <span className="tabular-nums text-slate-500">{formatAmount(t.legs[0].amount, t.legs[0].currency)}</span>
                      ) : null}
                      <Badge tone={t.status === 'posted' ? 'success' : 'neutral'}>{t.status}</Badge>
                      <span className="tabular-nums text-xs text-slate-400">{formatDateTime(t.postedAt)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {feedQuery.data?.nextCursor ? (
          <div className="flex justify-center pt-2">
            <Button variant="secondary" onClick={() => setCursor(feedQuery.data!.nextCursor)}>
              Load more
            </Button>
          </div>
        ) : null}
      </Card>

      {selected ? <TransactionDetailModal transactionId={selected} onClose={() => setSelected(undefined)} /> : null}
    </div>
  );
}