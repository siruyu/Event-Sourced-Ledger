import { useMemo, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { getAccountTransactions, voidTransaction } from '@/api/accounts';
import type { AccountTransactionItem } from '@/api/types';
import { ApiError } from '@/api/client';
import { Button, EmptyState, ErrorState, Modal, Spinner, useToast } from '@/components/ui';
import { formatAmount, formatDateTime } from '@/lib/format';

/** Pages through the account's transactions to find the truly latest posted. */
async function collectTransactions(id: string): Promise<AccountTransactionItem[]> {
  const items: AccountTransactionItem[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 100; i++) {
    const page = await getAccountTransactions(id, { cursor, limit: 100 });
    items.push(...page.items);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return items;
}

export function VoidModal({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [error, setError] = useState<string>();

  const txQuery = useQuery({
    queryKey: ['account-transactions', accountId],
    queryFn: () => collectTransactions(accountId),
  });

  const latest = useMemo(
    () => (txQuery.data ?? []).filter((t) => t.status === 'posted').at(-1),
    [txQuery.data],
  );

  const mutation = useMutation({
    mutationFn: () => voidTransaction(latest!.transactionId),
    onSuccess: () => {
      toast('success', 'Transaction voided — a reversal was posted');
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['account', accountId] });
      void qc.invalidateQueries({ queryKey: ['audit', accountId] });
      void qc.invalidateQueries({ queryKey: ['account-balance', accountId] });
      void qc.invalidateQueries({ queryKey: ['account-transactions', accountId] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not void the transaction');
    },
  });

  return (
    <Modal
      title="Void a transaction"
      onClose={onClose}
      footer={
        latest ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setError(undefined);
                mutation.mutate();
              }}
              loading={mutation.isPending}
            >
              Void transaction
            </Button>
          </>
        ) : null
      }
    >
      <div className="space-y-4">
        {txQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        ) : txQuery.isError ? (
          <ErrorState message="Could not load transactions." onRetry={() => void txQuery.refetch()} />
        ) : !latest ? (
          <EmptyState title="Nothing to void" hint="Every transaction on this account has already been voided." />
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Void the latest posted transaction? The original stays on the ledger; a{' '}
              <span className="font-medium text-slate-900">reversal</span> with offsetting entries is
              appended, leaving the balance unchanged overall.
            </p>
            <dl className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <div className="flex justify-between gap-4 py-0.5">
                <dt className="text-slate-500">Type</dt>
                <dd className="font-medium capitalize text-slate-900">{latest.type}</dd>
              </div>
              <div className="flex justify-between gap-4 py-0.5">
                <dt className="text-slate-500">Amount</dt>
                <dd className="tabular-nums text-slate-900">{formatAmount(latest.amount, latest.currency)}</dd>
              </div>
              <div className="flex justify-between gap-4 py-0.5">
                <dt className="text-slate-500">Posted</dt>
                <dd className="tabular-nums text-slate-900">{formatDateTime(latest.postedAt)}</dd>
              </div>
              {latest.reference ? (
                <div className="flex justify-between gap-4 py-0.5">
                  <dt className="text-slate-500">Reference</dt>
                  <dd className="font-mono text-slate-900">{latest.reference}</dd>
                </div>
              ) : null}
            </dl>
          </>
        )}

        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}