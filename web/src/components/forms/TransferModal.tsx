import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listAccounts, transfer } from '@/api/accounts';
import { ApiError } from '@/api/client';
import { Button, Field, Input, Modal, Select, Spinner, useToast } from '@/components/ui';

export function TransferModal({ defaultFromId, onClose }: { defaultFromId?: string; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [fromAccountId, setFromAccountId] = useState(defaultFromId ?? '');
  const [toAccountId, setToAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [fxRate, setFxRate] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string>();

  const accountsQuery = useQuery({ queryKey: ['accounts', 'all'], queryFn: () => listAccounts({ limit: 100 }) });
  const accounts = accountsQuery.data?.items ?? [];

  const fromAccount = accounts.find((a) => a.id === fromAccountId);
  const toAccount = accounts.find((a) => a.id === toAccountId);
  const crossCurrency = Boolean(fromAccount && toAccount && fromAccount.currency !== toAccount.currency);

  const mutation = useMutation({
    mutationFn: () =>
      transfer({
        fromAccountId,
        toAccountId,
        amount: amount.trim(),
        fxRate: crossCurrency && fxRate.trim() ? fxRate.trim() : undefined,
        reference: reference.trim() || undefined,
      }),
    onSuccess: () => {
      toast('success', 'Transfer posted');
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      void qc.invalidateQueries({ queryKey: ['account', fromAccountId] });
      void qc.invalidateQueries({ queryKey: ['account', toAccountId] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
      void qc.invalidateQueries({ queryKey: ['account-balance'] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not post the transfer');
    },
  });

  const fromCurrencies = useMemo(() => new Map(accounts.map((a) => [a.id, a.currency])), [accounts]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    mutation.mutate();
  };

  const canSubmit = Boolean(fromAccountId && toAccountId && fromAccountId !== toAccountId && amount.trim()) && (!crossCurrency || Boolean(fxRate.trim()));

  return (
    <Modal
      title="Transfer"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="transfer-form" type="submit" disabled={!canSubmit} loading={mutation.isPending}>
            Transfer
          </Button>
        </>
      }
    >
      {accountsQuery.isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner className="h-6 w-6 text-brand-600" />
        </div>
      ) : (
        <form id="transfer-form" className="space-y-4" onSubmit={onSubmit}>
          <Field id="tr-from" label="From account">
            <Select id="tr-from" value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)} required>
              <option value="" disabled>
                Select account…
              </option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </Select>
          </Field>
          <Field id="tr-to" label="To account">
            <Select id="tr-to" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} required>
              <option value="" disabled>
                Select account…
              </option>
              {accounts
                .filter((a) => a.id !== fromAccountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field id="tr-amount" label={`Amount (${fromCurrencies.get(fromAccountId) ?? '—'})`}>
              <Input
                id="tr-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                autoComplete="off"
                required
              />
            </Field>
            <Field
              id="tr-fx"
              label="FX rate"
              hint={crossCurrency ? 'Destination units per source unit.' : undefined}
            >
              <Input
                id="tr-fx"
                inputMode="decimal"
                value={fxRate}
                onChange={(e) => setFxRate(e.target.value)}
                placeholder={crossCurrency ? 'e.g. 0.85' : 'Same currency'}
                disabled={!crossCurrency}
                required={crossCurrency}
                autoComplete="off"
              />
            </Field>
          </div>
          <Field id="tr-reference" label="Reference" hint="Optional idempotency key.">
            <Input
              id="tr-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. rent-jan"
              autoComplete="off"
            />
          </Field>
          {crossCurrency && fromAccount && toAccount ? (
            <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
              {fromAccount.currency} → {toAccount.currency}: destination leg converts at the rate above (half-up, 4dp).
            </p>
          ) : null}
          {error ? (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </Modal>
  );
}
