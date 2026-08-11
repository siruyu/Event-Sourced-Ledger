import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResultRow } from 'pg';
import { PG_POOL } from './providers';
import { ConflictSequenceError } from '@/domain/errors';

/**
 * Minimal SQL executor surface used inside ledger transactions. Repositories that
 * participate in a multi-statement transaction receive one of these and run all
 * statements on the same dedicated connection.
 */
export interface SqlExecutor {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

/** Postgres error codes that mean the transaction may be safely retried. */
const RETRYABLE_PG_CODES = new Set(['40001', '40P01', '55P03']);

const DEFAULT_MAX_RETRIES = 5;

/**
 * Runs a callback inside a single PostgreSQL transaction on a dedicated connection,
 * holding row locks for the transaction's full duration. Commits on success,
 * rolls back (and rethrows) on error, and always releases the client.
 *
 * Transient concurrency failures (serialization/deadlock/lock timeout) are
 * retried up to `TX_MAX_RETRIES` with exponential backoff; when the budget is
 * exhausted a stable `CONFLICT_SEQUENCE` domain error is surfaced.
 */
@Injectable()
export class PostgresTransactionRunner {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Optional() private readonly config?: ConfigService,
  ) {}

  async withTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const maxRetries = this.retries();
    let attempt = 0;

    for (;;) {
      try {
        return await this.runOnce(fn);
      } catch (err) {
        const code = (err as { code?: string } | undefined)?.code;
        if (!code || !RETRYABLE_PG_CODES.has(code)) throw err;

        if (attempt < maxRetries) {
          attempt += 1;
          await this.backoff(attempt);
          continue;
        }
        throw new ConflictSequenceError('Concurrent write conflict: retry budget exhausted');
      }
    }
  }

  private async runOnce<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx: SqlExecutor = {
      query: <R extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) =>
        client.query<R>(sql, params).then((res) => ({ rows: res.rows, rowCount: res.rowCount })),
    };
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* connection may be broken; nothing to roll back */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  private retries(): number {
    const raw = this.config?.get<string>('TX_MAX_RETRIES');
    const parsed = raw === undefined ? DEFAULT_MAX_RETRIES : Number(raw);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_RETRIES;
  }

  private async backoff(attempt: number): Promise<void> {
    const ms = Math.min(50 * 2 ** (attempt - 1), 1000);
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
