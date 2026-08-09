export type BalanceSide = 'debit' | 'credit';
export type AccountStatus = 'active' | 'frozen' | 'closed';
export type EntryDirection = 'debit' | 'credit';

export interface AccountRow {
  id: string;
  accountNumber: string;
  name: string;
  type: string;
  normalSide: BalanceSide;
  currency: string;
  overdraftLimit: string;
  status: AccountStatus;
  currentSequence: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionRow {
  id: string;
  reference: string | null;
  type: string;
  status: string;
  description: string | null;
  metadata: Record<string, unknown>;
  postedAt: Date;
  createdAt: Date;
}

export interface LedgerEntryRow {
  id: number;
  transactionId: string;
  accountId: string;
  seq: number;
  direction: EntryDirection;
  amount: string;
  currency: string;
  createdAt: Date;
}
