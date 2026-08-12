import { useQuery } from '@tanstack/react-query';
import { getTransaction } from '@/api/accounts';
import type { Transaction } from '@/api/types';
import { Badge, ErrorState, Modal, Spinner } from '@/components/ui';
import { CopyButton } from '@/components/CopyButton';
import { formatAmount, formatDateTime } from '@/lib/format';

const typeTone: Record<string, string> = {
  deposit: 'border-emerald-500/50 text-emerald-500',
  withdrawal: 'border-rose-500/50 text-rose-500',
  transfer: 'border-brand-600 text-slate-200',
  reversal: 'border-amber-500/50 text-amber-500',
  fee: 'border-slate-600 text-slate-500',
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
        <span className={`inline-flex items-center border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${typeTone[tx.type] ?? typeTone.fee}`}>
          {tx.type}
        </span>
        <Badge tone={tx.status === 'posted' ? 'success' : 'neutral'}>{tx.status}</Badge>
        <span className="font-mono text-xs text-slate-500">{formatDateTime(tx.postedAt)}</span>
      </div>

      {tx.reference ? (
        <p className="font-mono text-xs text-slate-500">
          Reference: <span className="text-slate-200">{tx.reference}</span>
        </p>
      ) : null}
      {tx.description ? <p className="text-sm text-slate-500">{tx.description}</p> : null}

      <div>
        <h3 className="tech-label">Legs</h3>
        <ul className="mt-1 divide-y divide-slate-200 border border-slate-600">
          {tx.legs.map((leg, i) => (
            <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 font-mono text-sm">
              <span className="text-slate-500">
                <span className={`font-semibold uppercase ${leg.direction === 'debit' ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {leg.direction}
                </span>
                <span className="text-xs text-slate-600"> · {leg.accountId}</span>
              </span>
              <span className="tabular font-medium text-slate-100">
                {formatAmount(leg.amount, leg.currency)}
              </span>
            </li>
          ))}
        </ul>
        {Object.keys(total).length > 1 ? (
          <p className="mt-1 font-mono text-xs text-slate-500">
            Cross-currency totals: {Object.entries(total).map(([c, v]) => `${formatAmount(String(v), c)}`).join(' / ')}
          </p>
        ) : null}
      </div>

      {Object.keys(tx.metadata ?? {}).length > 0 ? (
        <div>
          <h3 className="tech-label">Metadata</h3>
          <pre className="mt-1 overflow-x-auto border border-slate-600 bg-black/40 p-3 font-mono text-xs text-slate-400">{JSON.stringify(tx.metadata, null, 2)}</pre>
        </div>
      ) : null}

      <div className="flex items-center justify-between border-t border-slate-700 pt-3">
        <span className="font-mono text-[10px] text-slate-600">{tx.id}</span>
        <CopyButton value={tx.id} label="Transaction ID" />
      </div>
    </div>
  );
}