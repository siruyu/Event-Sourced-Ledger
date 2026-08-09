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
   * Replays an account's history in sequence order, optionally truncated to an
   * as-of timestamp. Point-in-time consistency is safe because both legs of a
   * transaction share the same posted_at (and the same write transaction).
   */
  async replay(accountId: string, asOf?: Date): Promise<LedgerEntryRow[]> {
    const { rows } = await this.pool.query<LedgerEntryRow>(
      `SELECT id, transaction_id AS "transactionId", account_id AS "accountId",
              seq, direction, amount, currency, created_at AS "createdAt"
         FROM entries
        WHERE account_id = $1
          AND ($2::timestamptz IS NULL OR created_at <= $2)
        ORDER BY seq ASC`,
      [accountId, asOf ?? null],
    );
    return rows;
  }

  /**
   * Derived balances for a set of accounts (optionally as of a timestamp).
   * Each account's balance follows its normal side: entries in the normal
   * direction add, entries in the opposite direction subtract.
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
      `SELECT e.account_id AS "accountId",
              COALESCE(
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
        WHERE e.account_id = ANY($1::uuid[])
          AND ($2::timestamptz IS NULL OR e.created_at <= $2)
        GROUP BY e.account_id`,
      [accountIds, asOf ?? null],
    );

    for (const r of rows) {
      result.set(r.accountId, r.balance);
    }
    return result;
  }
}
