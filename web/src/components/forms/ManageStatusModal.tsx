import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateAccountStatus } from '@/api/accounts';
import type { Account } from '@/api/types';
import { ApiError } from '@/api/client';
import { Button, Modal, useToast } from '@/components/ui';

const ACTIONS: { label: string; tone: 'primary' | 'danger' | 'secondary'; next: Account['status']; hint: string }[] = [
  { label: 'Freeze', tone: 'secondary', next: 'frozen', hint: 'Blocks deposits, withdrawals, and transfers. Reads keep working.' },
  { label: 'Reactivate', tone: 'primary', next: 'active', hint: 'Unfreezes the account and restores all operations.' },
  { label: 'Close', tone: 'danger', next: 'closed', hint: 'Permanently closes. Requires a zero balance.' },
];

export function ManageStatusModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [error, setError] = useState<string>();

  const mutation = useMutation({
    mutationFn: (status: Account['status']) => updateAccountStatus(account.id, status),
    onSuccess: (_data, status) => {
      toast('success', `Account ${status}`);
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['account', account.id] });
      void qc.invalidateQueries({ queryKey: ['status-history', account.id] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not update account status');
    },
  });

  return (
    <Modal title={`Manage status — ${account.name}`} onClose={onClose} footer={null}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Current status: <span className="font-semibold text-slate-900">{account.status}</span>
        </p>

        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {ACTIONS.map((action) => {
            const isCurrent = account.status === action.next;
            const fromClosed = account.status === 'closed' && action.next !== 'closed';
            return (
              <li key={action.next} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{action.label}</p>
                  <p className="text-xs text-slate-500">{action.hint}</p>
                </div>
                <Button
                  variant={action.tone}
                  onClick={() => {
                    setError(undefined);
                    mutation.mutate(action.next);
                  }}
                  loading={mutation.isPending}
                  disabled={isCurrent || fromClosed}
                  className="shrink-0"
                >
                  {action.label}
                </Button>
              </li>
            );
          })}
        </ul>

        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}