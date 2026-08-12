export interface Account {
  id: string;
  accountNumber: string;
  name: string;
  type: string;
  normalSide: 'debit' | 'credit';
  currency: string;
  overdraftLimit: string;
  status: 'active' | 'frozen' | 'closed';
  balance: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface AuditEvent {
  seq: number;
  transactionId: string;
  type: string;
  reference: string | null;
  description: string | null;
  direction: 'debit' | 'credit';
  amount: string;
  effect: string;
  runningBalance: string;
  postedAt: string;
  fxRate?: string;
  counterparty: { accountId: string; accountNumber: string; name: string } | null;
  explanation: string;
}

export interface AuditView extends Page<AuditEvent> {
  accountId: string;
  accountNumber: string;
  balance: string;
  asOf?: string;
}

export interface TransactionLeg {
  accountId: string;
  direction: 'debit' | 'credit';
  amount: string;
  currency: string;
}

export interface Transaction {
  id: string;
  type: string;
  status: string;
  reference: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  postedAt: string;
  legs: TransactionLeg[];
}

/** One row of `GET /accounts/:id/transactions` (per-transaction leg summary). */
export interface AccountTransactionItem {
  seq: number;
  transactionId: string;
  type: string;
  status: string;
  reference: string | null;
  description: string | null;
  direction: 'debit' | 'credit';
  amount: string;
  currency: string;
  postedAt: string;
}

export interface CreateAccountInput {
  name: string;
  type?: string;
  normalSide?: 'debit' | 'credit';
  currency?: string;
  overdraftLimit?: string;
}

export interface MovementInput {
  amount: string;
  reference?: string;
  description?: string;
}

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  reference?: string;
  description?: string;
  fxRate?: string;
}

export interface StatusHistoryItem {
  seq: number;
  type: string;
  createdAt: string;
  reason?: string;
  resultingStatus: 'active' | 'frozen' | 'closed';
}
