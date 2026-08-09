import { Money } from '@/domain/money';
import type { TransactionRow, LedgerEntryRow } from '@/infrastructure/types';

export interface TransactionLegView {
  accountId: string;
  direction: 'debit' | 'credit';
  amount: string;
  currency: string;
}

export interface TransactionView {
  id: string;
  type: string;
  status: string;
  reference: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  postedAt: string;
  legs: TransactionLegView[];
}

export function toTransactionView(row: TransactionRow, entries: LedgerEntryRow[]): TransactionView {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    reference: row.reference,
    description: row.description,
    metadata: row.metadata,
    postedAt: row.postedAt.toISOString(),
    legs: entries
      .sort((a, b) => a.id - b.id)
      .map((e) => ({
        accountId: e.accountId,
        direction: e.direction,
        amount: Money.fromDecimalString(e.amount).toDecimalString(),
        currency: e.currency,
      })),
  };
}