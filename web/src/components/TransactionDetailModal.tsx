import { useQuery } from '@tanstack/react-query';
import { getTransaction } from '@/api/accounts';
import type { Transaction } from '@/api/types';
import { Badge, ErrorState, Modal, Spinner } from '@/components/ui';
import { CopyButton } from '@/components/CopyButton';
import { formatAmount, formatDateTime } from '@/lib/format';

const typeTone: Record<string, string> = {
  deposit: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  withdrawal: 'bg-rose-50 text-rose-700 ring-rose-200',
  transfer: 'bg-brand-50 text-brand-700 ring-brand-200',
  reversal: 'bg-amber-50 text-amber-700 ring-amber-200',
  fee: 'bg-slate-100 text-slate-700 ring-slate-200',
};

export function TransactionDetailModal({ transactionId, onClose }: { transactionId: string; onClose: () => void }) {
  const query = useQuery({
    queryKey: ['transaction', transactionId],
    queryFn: () => getTransaction(transactionId),
  });

  return (
    <Modal title="Transaction detail" onClose={onClose} footer={null}>
      <div className="space-y-4">
        {query.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : query.isError ? (
          <ErrorState message="Could not load this transaction." onRetry={() => void query.refetch()} />
        ) : query.data ? (
          <TxDetail tx={query.data} />
        ) : null}
      </div>
    </Modal>
  );
}

function TxDetail({ tx }: { tx: Transaction }) {
  const total = tx.legs.reduce(
    (acc, l) => {
      acc[l.currency] = (acc[l.currency] ?? 0) + Number(l.amount);
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${typeTone[tx.type] ?? typeTone.fee}`}>
          {tx.type}
        </span>
        <Badge tone={tx.status === 'posted' ? 'success' : 'neutral'}>{tx.status}</Badge>
        <span className="text-xs text-slate-400">{formatDateTime(tx.postedAt)}</span>
      </div>

      {tx.reference ? (
        <p className="text-sm text-slate-600">
          Reference: <span className="font-mono text-slate-900">{tx.reference}</span>
        </p>
      ) : null}
      {tx.description ? <p className="text-sm text-slate-600">{tx.description}</p> : null}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Legs</h3>
        <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {tx.legs.map((leg, i) => (
            <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="text-slate-600">
                <span className={`font-semibold ${leg.direction === 'debit' ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {leg.direction}
                </span>
                <span className="font-mono text-xs text-slate-400"> · {leg.accountId}</span>
              </span>
              <span className="tabular-nums font-medium text-slate-900">
                {formatAmount(leg.amount, leg.currency)}
              </span>
            </li>
          ))}
        </ul>
        {Object.keys(total).length > 1 ? (
          <p className="mt-1 text-xs text-slate-500">
            Cross-currency totals: {Object.entries(total).map(([c, v]) => `${formatAmount(String(v), c)}`).join(' / ')}
          </p>
        ) : null}
      </div>

      {Object.keys(tx.metadata ?? {}).length > 0 ? (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Metadata</h3>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{JSON.stringify(tx.metadata, null, 2)}</pre>
        </div>
      ) : null}

      <div className="flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="text-xs text-slate-400">{tx.id}</span>
        <CopyButton value={tx.id} label="Transaction ID" />
      </div>
    </div>
  );
}