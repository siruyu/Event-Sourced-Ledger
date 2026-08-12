import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateAccountLimit } from '@/api/accounts';
import type { Account } from '@/api/types';
import { ApiError } from '@/api/client';
import { Button, Field, Input, Modal, useToast } from '@/components/ui';

export function ManageLimitModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [value, setValue] = useState(account.overdraftLimit);
  const [error, setError] = useState<string>();

  const mutation = useMutation({
    mutationFn: () => updateAccountLimit(account.id, value.trim()),
    onSuccess: () => {
      toast('success', 'Overdraft limit updated');
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['account', account.id] });
      void qc.invalidateQueries({ queryKey: ['status-history', account.id] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not update the limit');
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    mutation.mutate();
  };

  return (
    <Modal
      title={`Overdraft limit — ${account.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="limit-form" type="submit" loading={mutation.isPending}>
            Save limit
          </Button>
        </>
      }
    >
      <form id="limit-form" className="space-y-4" onSubmit={onSubmit}>
        <p className="text-sm text-slate-600">
          The account may carry a balance down to <span className="font-semibold text-slate-900">-{value || '0'}</span> but no
          lower. Recorded on the account event stream as a <code className="font-mono text-xs">limit_changed</code> event.
        </p>
        <Field id="limit-value" label={`Overdraft limit (${account.currency})`} hint="Decimal string, e.g. 500.00">
          <Input
            id="limit-value"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0.00"
            autoComplete="off"
            required
          />
        </Field>
        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}