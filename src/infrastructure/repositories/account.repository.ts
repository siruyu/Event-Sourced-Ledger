import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DRIZZLE_DB, type Database } from '@/infrastructure/db/providers';
import { type SqlExecutor } from '@/infrastructure/db/tx-runner';
import { accounts, type NewAccount } from '../../../db/schema';
import { type AccountRow } from '@/infrastructure/types';

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

  async list(): Promise<AccountRow[]> {
    const rows = await this.db.select().from(accounts);
    return rows as AccountRow[];
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
