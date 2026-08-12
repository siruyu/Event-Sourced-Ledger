import { Inject, Injectable } from '@nestjs/common';
import { Pool, type QueryResultRow } from 'pg';
import { PG_POOL } from '@/infrastructure/db/providers';
import type { SqlExecutor } from '@/infrastructure/db/tx-runner';
import { type LedgerEntryRow, type TransactionRow } from '@/infrastructure/types';

export type Queryable = {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;
};

export interface AppendEntryInput {
  transactionId: string;
  accountId: string;
  seq: number;
  direction: 'debit' | 'credit';
  amount: string;
  currency: string;
}

export interface InsertTransactionInput {
  id: string;
  type: string;
  reference?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  postedAt: Date;
}

export interface AuditRow {
  seq: number;
  direction: 'debit' | 'credit';
  amount: string;
  currency: string;
  createdAt: Date;
  transactionId: string;
  type: string;
  reference: string | null;
  description: string | null;
  postedAt: Date;
  metadata: Record<string, unknown> | null;
  counterpartyIds: string[];
}

export interface AccountTransactionRow {
  seq: number;
  transactionId: string;
  type: string;
  reference: string | null;
  description: string | null;
  status: string;
  postedAt: Date;
  direction: 'debit' | 'credit';
  amount: string;
  currency: string;
}

export interface GlobalTransactionLeg {
  accountId: string;
  accountNumber: string;
  accountName: string;
  direction: 'debit' | 'credit';
  amount: string;
  currency: string;
}

export interface GlobalTransactionRow {
  id: string;
  type: string;
  status: string;
  reference: string | null;
  description: string | null;
  postedAt: Date;
  legs: GlobalTransactionLeg[];
}

/**
 * The event store. Writes are append-only and always executed inside the caller's
 * transaction (a SqlExecutor); reads run directly on the pool. Never exposes an
 * UPDATE/DELETE path for entries.
 */
@Injectable()
export class LedgerStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private resolveQueryable(queryable?: Queryable): Queryable {
    return queryable ?? this.pool;
  }

  async insertTransaction(tx: SqlExecutor, input: InsertTransactionInput): Promise<void> {
    await tx.query(
      `INSERT INTO transactions (id, reference, type, status, description, metadata, posted_at)
       VALUES ($1, $2, $3, 'posted', $4, $5, $6)`,
      [
        input.id,
        input.reference ?? null,
        input.type,
        input.description ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.postedAt,
      ],
    );
  }

  /**
   * Appends ledger entries in a single multi-row INSERT. Each entry carries a
   * per-account sequence number; the UNIQUE(account_id, seq) constraint is the
   * final guard against duplicate history positions.
   */
  async appendEntries(tx: SqlExecutor, inputs: AppendEntryInput[]): Promise<void> {
    if (inputs.length === 0) return;

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let i = 1;
    for (const e of inputs) {
      placeholders.push(
        `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`,
      );
      values.push(e.transactionId, e.accountId, e.seq, e.direction, e.amount, e.currency);
    }

    await tx.query(
      `INSERT INTO entries (transaction_id, account_id, seq, direction, amount, currency)
       VALUES ${placeholders.join(', ')}`,
      values,
    );
  }

  async findTransaction(id: string): Promise<TransactionRow | null> {
    const { rows } = await this.pool.query<TransactionRow>(
      `SELECT id, reference, type, status, description, metadata,
              posted_at AS "postedAt", created_at AS "createdAt"
         FROM transactions WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findTransactionByReference(reference: string): Promise<TransactionRow | null> {
    const { rows } = await this.pool.query<TransactionRow>(
      `SELECT id, reference, type, status, description, metadata,
              posted_at AS "postedAt", created_at AS "createdAt"
         FROM transactions WHERE reference = $1`,
      [reference],
    );
    return rows[0] ?? null;
  }

  async entriesForTransaction(transactionId: string): Promise<LedgerEntryRow[]> {
    const { rows } = await this.pool.query<LedgerEntryRow>(
      `SELECT id, transaction_id AS "transactionId", account_id AS "accountId",
              seq, direction, amount, currency, created_at AS "createdAt"
         FROM entries WHERE transaction_id = $1 ORDER BY id`,
      [transactionId],
    );
    return rows;
  }

  /**
   * Marks a posted transaction void (idempotent-guard: only transitions a
   * posted row). Returns whether the transition actually happened.
   */
  async markTransactionVoid(tx: SqlExecutor, id: string): Promise<boolean> {
    const { rowCount } = await tx.query(
      `UPDATE transactions SET status = 'void' WHERE id = $1 AND status = 'posted'`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Derived balance of a single account including only entries with
   * `seq <= upToSeq` (optionally also bounded by `asOf`). Used to seed the
   * running balance for keyset-paginated audit reads without replaying the
   * account's full history on every page.
   */
  async balanceUpToSeq(
    accountId: string,
    upToSeq: number,
    asOf?: Date,
  ): Promise<string> {
    const { rows } = await this.pool.query<{ balance: string }>(
      `SELECT COALESCE(
                SUM(CASE
                      WHEN (e.direction = 'debit'  AND a.normal_side = 'debit')
                        OR (e.direction = 'credit' AND a.normal_side = 'credit')
                      THEN e.amount
                      ELSE -e.amount
                    END),
                0
              )::numeric(19,4) AS balance
         FROM entries e
         JOIN accounts a ON a.id = e.account_id
         JOIN transactions t ON t.id = e.transaction_id
        WHERE e.account_id = $1
          AND e.seq <= $2
          AND ($3::timestamptz IS NULL OR t.posted_at <= $3)`,
      [accountId, upToSeq, asOf ?? null],
    );
    return rows[0]?.balance ?? '0';
  }

  /** The account's latest applied sequence number (for snapshot scheduling). */
  async currentSequence(accountId: string): Promise<number> {
    const { rows } = await this.pool.query<{ seq: number }>(
      'SELECT current_sequence AS seq FROM accounts WHERE id = $1',
      [accountId],
    );
    return rows[0]?.seq ?? 0;
  }

  /** The latest snapshot seq for an account, or null when none exists yet. */
  async latestSnapshotSeq(accountId: string): Promise<number | null> {
    const { rows } = await this.pool.query<{ seq: number }>(
      'SELECT seq FROM snapshots WHERE account_id = $1 ORDER BY seq DESC LIMIT 1',
      [accountId],
    );
    return rows[0]?.seq ?? null;
  }

  /**
   * Writes a snapshot idempotently: `UNIQUE(account_id, seq)` guarantees a
   * concurrent writer cannot create a duplicate position (DO NOTHING).
   */
  async insertSnapshot(input: {
    accountId: string;
    seq: number;
    balance: string;
    currency: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO snapshots (account_id, seq, balance, currency)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, seq) DO NOTHING`,
      [input.accountId, input.seq, input.balance, input.currency],
    );
  }

  /**
   * Replays an account's history in sequence order, optionally truncated to an
   * as-of timestamp. Point-in-time consistency is safe because both legs of a
   * transaction share the same posted_at (and the same write transaction).
   */
  async replay(accountId: string, asOf?: Date): Promise<LedgerEntryRow[]> {
    const { rows } = await this.pool.query<LedgerEntryRow>(
      `SELECT e.id, e.transaction_id AS "transactionId", e.account_id AS "accountId",
              e.seq, e.direction, e.amount, e.currency, e.created_at AS "createdAt"
         FROM entries e
         JOIN transactions t ON t.id = e.transaction_id
        WHERE e.account_id = $1
          AND ($2::timestamptz IS NULL OR t.posted_at <= $2)
        ORDER BY e.seq ASC`,
      [accountId, asOf ?? null],
    );
    return rows;
  }

  /**
   * Audit trail rows for an account: each event joined to its transaction, with
   * the sibling (counterparty) account ids of the same transaction. Supports
   * keyset pagination by per-account seq.
   */
  async rawAudit(
    accountId: string,
    asOf?: Date,
    afterSeq?: number | null,
    limit?: number,
    range?: { from?: Date; to?: Date },
  ): Promise<AuditRow[]> {
    const { rows } = await this.pool.query<AuditRow>(
      `SELECT e.seq, e.direction, e.amount, e.currency, e.created_at AS "createdAt",
              t.id AS "transactionId", t.type, t.reference, t.description,
              t.posted_at AS "postedAt", t.metadata,
              COALESCE((
                SELECT array_agg(e2.account_id::text)
                  FROM entries e2
                 WHERE e2.transaction_id = e.transaction_id
                   AND e2.account_id <> e.account_id
              ), ARRAY[]::text[]) AS "counterpartyIds"
         FROM entries e
         JOIN transactions t ON t.id = e.transaction_id
        WHERE e.account_id = $1
          AND ($2::timestamptz IS NULL OR t.posted_at <= $2)
          AND ($3::bigint IS NULL OR e.seq > $3)
          AND ($5::timestamptz IS NULL OR t.posted_at >= $5)
          AND ($6::timestamptz IS NULL OR t.posted_at <= $6)
        ORDER BY e.seq ASC
        LIMIT $4`,
      [accountId, asOf ?? null, afterSeq ?? null, limit ?? null, range?.from ?? null, range?.to ?? null],
    );
    return rows;
  }

  /** Keyset-paginated list of an account's own transaction legs, oldest-first (ascending seq). */
  async paginateAccountTransactions(
    accountId: string,
    afterSeq: number | null,
    limit: number,
  ): Promise<AccountTransactionRow[]> {
    const { rows } = await this.pool.query<AccountTransactionRow>(
      `SELECT e.seq, t.id AS "transactionId", t.type, t.reference, t.description,
              t.status, t.posted_at AS "postedAt", e.direction, e.amount, e.currency
         FROM entries e
         JOIN transactions t ON t.id = e.transaction_id
        WHERE e.account_id = $1 AND ($2::bigint IS NULL OR e.seq > $2)
        ORDER BY e.seq ASC
        LIMIT $3`,
      [accountId, afterSeq ?? null, limit],
    );
    return rows;
  }

  /**
   * Global transaction feed (all accounts), newest-first, keyset-paginated by
   * `(posted_at, id)` descending. Each row carries the full leg set so
   * cross-currency transfers are unambiguous. Optional type/status filters.
   */
  async paginateGlobalTransactions(
    cursor: { postedAt: string; id: string } | null,
    limit: number,
    filters?: { type?: string; status?: string },
  ): Promise<GlobalTransactionRow[]> {
    const { rows } = await this.pool.query<GlobalTransactionRow>(
      `SELECT t.id, t.type, t.status, t.reference, t.description,
              t.posted_at AS "postedAt",
              COALESCE(jsonb_agg(
                jsonb_build_object(
                  'accountId', e.account_id::text,
                  'accountNumber', a.account_number,
                  'accountName', a.name,
                  'direction', e.direction,
                  'amount', e.amount::text,
                  'currency', e.currency
                )
                ORDER BY a.account_number
              ) FILTER (WHERE e.id IS NOT NULL), '[]'::jsonb) AS legs
         FROM transactions t
         JOIN entries e ON e.transaction_id = t.id
         JOIN accounts a ON a.id = e.account_id
        WHERE ($1::text IS NULL OR t.type::text = $1)
          AND ($2::text IS NULL OR t.status::text = $2)
          AND ($3::timestamptz IS NULL OR t.posted_at < $3
               OR (t.posted_at = $3::timestamptz AND t.id < $4::uuid))
        GROUP BY t.id
        ORDER BY t.posted_at DESC, t.id DESC
        LIMIT $5`,
      [filters?.type ?? null, filters?.status ?? null, cursor?.postedAt ?? null, cursor?.id ?? null, limit],
    );
    return rows;
  }

  /**
   * Derived balances for a set of accounts (optionally as of a timestamp).
   * Each account's balance follows its normal side: entries in the normal
   * direction add, entries in the opposite direction subtract.
   *
   * Snapshot-backed: the latest snapshot with `seq <= target` (and, for
   * point-in-time reads, `created_at <= as_of`) provides the base balance,
   * then only the trailing entries are summed. Accounts without a snapshot
   * fall back to a full replay, so results are always identical to a full
   * replay regardless of snapshot state.
   * Returns a Map<accountId, numericString>.
   */
  async balancesFor(
    accountIds: string[],
    asOf?: Date,
    queryable?: Queryable,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const id of accountIds) {
      result.set(id, '0');
    }
    if (accountIds.length === 0) return result;

    const q = this.resolveQueryable(queryable);
    const { rows } = await q.query<{ accountId: string; balance: string }>(
      `SELECT a.id AS "accountId",
              (COALESCE(s.base, 0) + COALESCE(t.delta, 0))::numeric(19,4) AS balance
         FROM accounts a
         LEFT JOIN LATERAL (
           SELECT sn.seq, sn.balance AS base
             FROM snapshots sn
            WHERE sn.account_id = a.id
              AND ($2::timestamptz IS NULL OR sn.created_at <= $2::timestamptz)
            ORDER BY sn.seq DESC
            LIMIT 1
         ) s ON TRUE
         LEFT JOIN LATERAL (
           SELECT COALESCE(
                    SUM(CASE
                          WHEN (e.direction = 'debit'  AND a.normal_side = 'debit')
                            OR (e.direction = 'credit' AND a.normal_side = 'credit')
                          THEN e.amount
                          ELSE -e.amount
                        END),
                    0
                  )::numeric(19,4) AS delta
             FROM entries e
             JOIN transactions t ON t.id = e.transaction_id
            WHERE e.account_id = a.id
              AND (s.seq IS NULL OR e.seq > s.seq)
              AND ($2::timestamptz IS NULL OR t.posted_at <= $2::timestamptz)
         ) t ON TRUE
        WHERE a.id = ANY($1::uuid[])`,
      [accountIds, asOf ?? null],
    );

    for (const r of rows) {
      result.set(r.accountId, r.balance);
    }
    return result;
  }
}
