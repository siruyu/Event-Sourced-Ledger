import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deposit, withdraw } from '@/api/accounts';
import { ApiError } from '@/api/client';
import { Button, Field, Input, Modal, useToast } from '@/components/ui';

type Kind = 'deposit' | 'withdraw';

const TITLES: Record<Kind, string> = { deposit: 'Deposit', withdraw: 'Withdraw' };

export function MovementModal({ accountId, currency, kind, onClose }: { accountId: string; currency: string; kind: Kind; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string>();

  const mutation = useMutation({
    mutationFn: async (value: string) =>
      kind === 'deposit'
        ? deposit(accountId, { amount: value, reference: reference.trim() || undefined })
        : withdraw(accountId, { amount: value, reference: reference.trim() || undefined }),
    onSuccess: () => {
      toast('success', `${TITLES[kind]} posted`);
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['account', accountId] });
      void qc.invalidateQueries({ queryKey: ['audit', accountId] });
      void qc.invalidateQueries({ queryKey: ['account-balance', accountId] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : `Could not ${kind}`);
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    mutation.mutate(amount.trim());
  };

  return (
    <Modal
      title={`${TITLES[kind]} — ${currency}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="movement-form" type="submit" loading={mutation.isPending}>
            {TITLES[kind]}
          </Button>
        </>
      }
    >
      <form id="movement-form" className="space-y-4" onSubmit={onSubmit}>
        <Field id="mv-amount" label={`Amount (${currency})`}>
          <Input
            id="mv-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            autoComplete="off"
            required
          />
        </Field>
        <Field id="mv-reference" label="Reference" hint="Optional idempotency key — retries with the same reference never double-post.">
          <Input
            id="mv-reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. payroll-jan"
            autoComplete="off"
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