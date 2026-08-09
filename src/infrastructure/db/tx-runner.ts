import { Inject, Injectable } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';
import { PG_POOL } from './providers';

/**
 * Minimal SQL executor surface used inside ledger transactions. Repositories that
 * participate in a multi-statement transaction receive one of these and run all
 * statements on the same dedicated connection.
 */
export interface SqlExecutor {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;
}

/**
 * Runs a callback inside a single PostgreSQL transaction on a dedicated connection,
 * holding row locks for the transaction's full duration. Commits on success,
 * rolls back (and rethrows) on error, and always releases the client.
 */
@Injectable()
export class PostgresTransactionRunner {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async withTransaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx: SqlExecutor = {
      query: <R extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) =>
        client.query<R>(sql, params).then((res) => ({ rows: res.rows })),
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
}