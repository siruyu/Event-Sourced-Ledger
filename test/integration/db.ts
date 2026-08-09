import { join } from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import '../../src/infrastructure/db/pg-types';

let pool: Pool | null = null;

/**
 * Returns a lazy singleton pool to the test database, applying schema migrations
 * on first use (idempotent — Drizzle tracks applied migrations).
 */
export async function getTestPool(): Promise<Pool> {
  if (pool) return pool;
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  pool = new Pool({ connectionString: url });
  await migrate(drizzle(pool), {
    migrationsFolder: join(__dirname, '..', '..', 'db', 'migrations'),
  });
  return pool;
}

/** Wipes all ledger data, leaving the schema intact. */
export async function resetDatabase(p: Pool): Promise<void> {
  await p.query(
    'TRUNCATE accounts, entries, transactions, snapshots RESTART IDENTITY CASCADE',
  );
}