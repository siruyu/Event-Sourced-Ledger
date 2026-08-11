import {
  bigint,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const accountType = pgEnum('account_type', [
  'checking',
  'savings',
  'credit_card',
  'cash',
  'investment',
]);

export const balanceSide = pgEnum('balance_side', ['debit', 'credit']);

export const accountStatus = pgEnum('account_status', ['active', 'frozen', 'closed']);

export const transactionType = pgEnum('transaction_type', [
  'deposit',
  'withdrawal',
  'transfer',
  'fee',
  'reversal',
]);

export const transactionStatus = pgEnum('transaction_status', ['posted', 'void']);

export const entryDirection = pgEnum('entry_direction', ['debit', 'credit']);

export const accountEventType = pgEnum('account_event_type', [
  'account_opened',
  'account_frozen',
  'account_reactivated',
  'account_closed',
  'limit_changed',
]);

/**
 * Operational metadata for an account.
 * Deliberately has NO balance column — balances are always derived from `entries`.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountNumber: varchar('account_number', { length: 20 }).notNull().unique(),
    name: varchar('name', { length: 120 }).notNull(),
    type: accountType('type').notNull().default('checking'),
    normalSide: balanceSide('normal_side').notNull().default('debit'),
    currency: char('currency', { length: 3 }).notNull().default('USD'),
    overdraftLimit: numeric('overdraft_limit', { precision: 19, scale: 4 })
      .notNull()
      .default('0'),
    status: accountStatus('status').notNull().default('active'),
    currentSequence: bigint('current_sequence', { mode: 'number' }).notNull().default(0),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('accounts_overdraft_limit_non_negative', sql`${t.overdraftLimit} >= 0`),
    check('accounts_currency_iso', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

/** Aggregate record grouping the ledger legs (entries) of one business operation. */
export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  reference: varchar('reference', { length: 64 }).unique(),
  type: transactionType('type').notNull(),
  status: transactionStatus('status').notNull().default('posted'),
  description: text('description'),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The append-only event log. One immutable event per ledger leg.
 * Application code only INSERTs here — never UPDATE/DELETE.
 */
export const entries = pgTable(
  'entries',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    direction: entryDirection('direction').notNull(),
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('entries_account_seq_unique').on(t.accountId, t.seq),
    uniqueIndex('entries_transaction_account_unique').on(t.transactionId, t.accountId),
    index('entries_account_seq_idx').on(t.accountId, t.seq),
    index('entries_transaction_idx').on(t.transactionId),
    check('entries_amount_positive', sql`${t.amount} > 0`),
    check('entries_currency_iso', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

/** (Stretch) stored running balance at a point in history, to bound replay cost. */
export const snapshots = pgTable(
  'snapshots',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    balance: numeric('balance', { precision: 19, scale: 4 }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('snapshots_account_seq_unique').on(t.accountId, t.seq)],
);

/**
 * Append-only account-aggregate event stream (T-26): lifecycle events such as
 * `account_opened` / `account_frozen` / `account_closed`. The `accounts` row is
 * a projection that can be rebuilt by replaying this stream. Distinct from the
 * `entries` money log (see architecture.md §4.5 for the two-stream trade-off).
 */
export const accountEvents = pgTable(
  'account_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    type: accountEventType('type').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('account_events_account_seq_unique').on(t.accountId, t.seq),
    index('account_events_account_seq_idx').on(t.accountId, t.seq),
  ],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type LedgerEntry = typeof entries.$inferSelect;
export type NewLedgerEntry = typeof entries.$inferInsert;
export type Snapshot = typeof snapshots.$inferSelect;
export type NewSnapshot = typeof snapshots.$inferInsert;
export type AccountEvent = typeof accountEvents.$inferSelect;
export type NewAccountEvent = typeof accountEvents.$inferInsert;
