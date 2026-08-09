import { Money } from '@/domain/money';
import type { AccountRow } from '@/infrastructure/types';

export interface AccountView {
  id: string;
  accountNumber: string;
  name: string;
  type: string;
  normalSide: 'debit' | 'credit';
  currency: string;
  overdraftLimit: string;
  status: string;
  balance: string;
  createdAt: string;
}

/** Formats a raw numeric DB string into the canonical 4-dp decimal string. */
export function normalizeAmount(value: string): string {
  return Money.fromDecimalString(value).toDecimalString();
}

export function toAccountView(account: AccountRow, balance: string): AccountView {
  return {
    id: account.id,
    accountNumber: account.accountNumber,
    name: account.name,
    type: account.type,
    normalSide: account.normalSide,
    currency: account.currency,
    overdraftLimit: normalizeAmount(account.overdraftLimit),
    status: account.status,
    balance: normalizeAmount(balance),
    createdAt: account.createdAt.toISOString(),
  };
}
