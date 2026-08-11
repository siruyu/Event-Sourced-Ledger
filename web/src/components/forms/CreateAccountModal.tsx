import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createAccount } from '@/api/accounts';
import { ApiError } from '@/api/client';
import { Button, Field, Input, Modal, Select, useToast } from '@/components/ui';

const ACCOUNT_TYPES = ['checking', 'savings', 'credit_card', 'cash', 'investment'] as const;
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'INR'] as const;

export function CreateAccountModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('checking');
  const [currency, setCurrency] = useState<string>('USD');
  const [overdraftLimit, setOverdraftLimit] = useState('0');
  const [error, setError] = useState<string>();

  const mutation = useMutation({
    mutationFn: createAccount,
    onSuccess: (account) => {
      toast('success', `Account ${account.name} created`);
      void qc.invalidateQueries({ queryKey: ['accounts'] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not create the account');
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    mutation.mutate({ name: name.trim(), type, currency, overdraftLimit: overdraftLimit || '0' });
  };

  return (
    <Modal
      title="Create account"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button form="create-account-form" type="submit" loading={mutation.isPending}>
            Create account
          </Button>
        </>
      }
    >
      <form id="create-account-form" className="space-y-4" onSubmit={onSubmit}>
        <Field id="acc-name" label="Name">
          <Input
            id="acc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alicia Checking"
            autoComplete="off"
            required
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field id="acc-type" label="Type">
            <Select id="acc-type" value={type} onChange={(e) => setType(e.target.value)}>
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="acc-currency" label="Currency">
            <Select id="acc-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          id="acc-overdraft"
          label="Overdraft limit"
          hint="Amount the balance may go below zero (0 = no overdraft)."
        >
          <Input
            id="acc-overdraft"
            inputMode="decimal"
            value={overdraftLimit}
            onChange={(e) => setOverdraftLimit(e.target.value)}
            placeholder="0.00"
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
