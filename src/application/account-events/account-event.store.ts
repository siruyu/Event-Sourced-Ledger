import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '@/infrastructure/db/providers';
import { PostgresTransactionRunner, type SqlExecutor } from '@/infrastructure/db/tx-runner';
import { AccountRepository } from '@/infrastructure/repositories/account.repository';

export type AccountEventType =
  | 'account_opened'
  | 'account_frozen'
  | 'account_reactivated'
  | 'account_closed'
  | 'limit_changed';

export interface AccountEventView {
  seq: number;
  type: AccountEventType;
  payload: Record<string, unknown>;
  version: number;
  createdAt: string;
}

interface AccountEventRow {
  seq: number;
  type: AccountEventType;
  payload: Record<string, unknown>;
  version: number;
  createdAt: Date;
}

/**
 * The append-only account-aggregate event stream (T-26). Lifecycle actions
 * append an immutable event; the `accounts` row is a projection that can be
 * rebuilt by replaying this stream. Sequence numbers are per-account and
 * computed under the caller's account row lock, so concurrent lifecycle changes
 * can never collide (`UNIQUE(account_id, seq)` is the final guard).
 */
@Injectable()
export class AccountEventStore {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly runner: PostgresTransactionRunner,
    private readonly accounts: AccountRepository,
  ) {}

  /**
   * Appends an event inside the caller's transaction (which must already hold
   * the account row lock, e.g. via `lockForUpdate`, or be creating the row).
   */
  async appendWithin(
    tx: SqlExecutor,
    accountId: string,
    type: AccountEventType,
    payload: Record<string, unknown>,
  ): Promise<AccountEventView> {
    const { rows } = await tx.query<AccountEventRow>(
      `INSERT INTO account_events (account_id, seq, type, payload, version)
       VALUES (
         $1,
         (SELECT COALESCE(MAX(seq), 0) + 1 FROM account_events WHERE account_id = $1),
         $2, $3, 1
       )
       RETURNING seq, type, payload, version, created_at AS "createdAt"`,
      [accountId, type, JSON.stringify(payload ?? {})],
    );
    return toView(rows[0]);
  }

  /** Convenience wrapper that manages its own transaction (locks the account). */
  async append(
    accountId: string,
    type: AccountEventType,
    payload: Record<string, unknown>,
  ): Promise<AccountEventView> {
    return this.runner.withTransaction(async (tx) => {
      const locked = await this.accounts.lockForUpdate(tx, [accountId]);
      if (locked.length === 0) throw new Error('Account not found');
      return this.appendWithin(tx, accountId, type, payload);
    });
  }

  /** Replays an account's lifecycle events in seq order (oldest → newest). */
  async replay(accountId: string): Promise<AccountEventView[]> {
    const { rows } = await this.pool.query<AccountEventRow>(
      `SELECT seq, type, payload, version, created_at AS "createdAt"
         FROM account_events
        WHERE account_id = $1
        ORDER BY seq ASC`,
      [accountId],
    );
    return rows.map(toView);
  }
}

function toView(row: AccountEventRow): AccountEventView {
  return {
    seq: row.seq,
    type: row.type,
    payload: row.payload,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

