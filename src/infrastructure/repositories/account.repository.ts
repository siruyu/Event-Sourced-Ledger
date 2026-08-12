import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB, type Database } from '@/infrastructure/db/providers';
import { type SqlExecutor } from '@/infrastructure/db/tx-runner';
import { accounts, type NewAccount } from '../../../db/schema';
import { type AccountRow } from '@/infrastructure/types';
import type { AccountType } from '@/domain/account';

export interface LockedAccount {
  id: string;
  accountNumber: string;
  normalSide: 'debit' | 'credit';
  currency: string;
  overdraftLimit: string;
  status: 'active' | 'frozen' | 'closed';
  currentSequence: number;
  metadata: Record<string, unknown>;
}

@Injectable()
export class AccountRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  async insert(tx: SqlExecutor, input: NewAccount): Promise<void> {
    await tx.query(
      `INSERT INTO accounts
         (id, account_number, name, type, normal_side, currency, overdraft_limit, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.id,
        input.accountNumber,
        input.name,
        input.type,
        input.normalSide,
        input.currency,
        input.overdraftLimit,
        input.status ?? 'active',
      ],
    );
  }

  /**
   * Inserts an account unless an account with the same account_number already
   * exists, returning the inserted id (or null when a concurrent insert won).
   * Race-safe for shared/well-known account numbers such as the internal cash
   * account: no unique-violation can escape to the caller.
   */
  async insertIfAbsent(tx: SqlExecutor, input: NewAccount): Promise<string | null> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO accounts
         (id, account_number, name, type, normal_side, currency, overdraft_limit, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (account_number) DO NOTHING
       RETURNING id`,
      [
        input.id,
        input.accountNumber,
        input.name,
        input.type,
        input.normalSide,
        input.currency,
        input.overdraftLimit,
        input.status ?? 'active',
      ],
    );
    return rows[0]?.id ?? null;
  }

  async findById(id: string): Promise<AccountRow | null> {
    const rows = await this.db.select().from(accounts).where(eq(accounts.id, id));
    return (rows[0] as AccountRow | undefined) ?? null;
  }

  async findByAccountNumber(accountNumber: string): Promise<AccountRow | null> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.accountNumber, accountNumber));
    return (rows[0] as AccountRow | undefined) ?? null;
  }

/**
   * Keyset pagination over accounts, sorted by (created_at, id). The cursor's
   * createdAt is the raw DB timestamp (microsecond precision) so the boundary
   * comparison is exact - no rows are skipped or repeated. Optional status/type
   * filters combine with the cursor (T-18).
   */
  async paginate(
    cursor: { createdAt: string; id: string } | null,
    limit: number,
    filters?: { status?: 'active' | 'frozen' | 'closed'; type?: AccountType },
  ): Promise<AccountRow[]> {
    const conditions: SQL[] = [];
    if (cursor) {
      conditions.push(sql`(${accounts.createdAt} > ${cursor.createdAt}::timestamptz
             OR (${accounts.createdAt} = ${cursor.createdAt}::timestamptz
                 AND ${accounts.id} > ${cursor.id}::uuid))`);
    }
    if (filters?.status) conditions.push(eq(accounts.status, filters.status));
    if (filters?.type) conditions.push(eq(accounts.type, filters.type));

    const rows = await this.db
      .select()
      .from(accounts)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(accounts.createdAt), asc(accounts.id))
      .limit(limit + 1);

    return rows as AccountRow[];
  }

  /** The full-precision (microsecond) created_at of an account, as raw text. */
  async rawCreatedAt(id: string): Promise<string> {
    const rows = await this.db
      .select({ createdAt: sql<string>`created_at::text` })
      .from(accounts)
      .where(eq(accounts.id, id));
    return rows[0]?.createdAt ?? '';
  }

  async accountInfoFor(
    ids: string[],
  ): Promise<Map<string, { accountNumber: string; name: string }>> {
    const result = new Map<string, { accountNumber: string; name: string }>();
    if (ids.length === 0) return result;
    const rows = await this.db
      .select({ id: accounts.id, accountNumber: accounts.accountNumber, name: accounts.name })
      .from(accounts)
      .where(inArray(accounts.id, ids));
    for (const r of rows) result.set(r.id, { accountNumber: r.accountNumber, name: r.name });
    return result;
  }

  /**
   * Locks the given accounts for update in a deterministic (id-sorted) order so
   * concurrent multi-account operations can never deadlock, then returns the
   * freshly locked rows (also sorted by id). If an id does not exist, the row is
   * simply absent from the result — callers must detect that.
   */
  async lockForUpdate(tx: SqlExecutor, ids: string[]): Promise<LockedAccount[]> {
    if (ids.length === 0) return [];
    const { rows } = await tx.query<LockedAccount>(
      `SELECT id, account_number AS "accountNumber",
              normal_side AS "normalSide", currency,
              overdraft_limit AS "overdraftLimit", status,
              current_sequence AS "currentSequence", metadata
         FROM accounts
        WHERE id = ANY($1::uuid[])
        ORDER BY id
        FOR UPDATE`,
      [ids],
    );
    return rows;
  }

  async bumpSequences(tx: SqlExecutor, updates: { id: string; seq: number }[]): Promise<void> {
    for (const u of updates) {
      await tx.query(
        `UPDATE accounts SET current_sequence = $2, updated_at = now() WHERE id = $1`,
        [u.id, u.seq],
      );
    }
  }
}
