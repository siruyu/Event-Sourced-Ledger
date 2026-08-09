import { randomUUID } from 'crypto';

export const ACCOUNT_TYPES = ['checking', 'savings', 'credit_card', 'cash', 'investment'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const BALANCE_SIDES = ['debit', 'credit'] as const;
export type BalanceSide = (typeof BALANCE_SIDES)[number];

export const ACCOUNT_STATUSES = ['active', 'frozen', 'closed'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ENTRY_DIRECTIONS = ['debit', 'credit'] as const;
export type EntryDirection = (typeof ENTRY_DIRECTIONS)[number];

export const TRANSACTION_TYPES = [
  'deposit',
  'withdrawal',
  'transfer',
  'fee',
  'reversal',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** The default balance side for each account type (assets are debit-normal). */
export const DEFAULT_NORMAL_SIDE: Record<AccountType, BalanceSide> = {
  checking: 'debit',
  savings: 'debit',
  cash: 'debit',
  investment: 'debit',
  credit_card: 'credit',
};

/** A human-friendly, globally unique display number. */
export function generateAccountNumber(): string {
  return `LE-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}
