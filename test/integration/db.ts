import { join } from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import '../../src/infrastructure/db/pg-types';

let pool: Pool | null = null;

/** Creates the test database if it does not exist (works on CI service containers). */
async function ensureDatabaseExists(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  const parsed = new URL(url);
  const dbName = parsed.pathname.slice(1);
  if (!dbName) throw new Error('TEST_DATABASE_URL must include a database name');

  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  const admin = new Pool({ connectionString: maintenance.toString(), connectionTimeoutMillis: 5_000 });
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (existing.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    }
  } finally {
    await admin.end();
  }
}

/**
 * Returns a lazy singleton pool to the test database, applying schema migrations
 * on first use (idempotent — Drizzle tracks applied migrations).
 */
export async function getTestPool(): Promise<Pool> {
  if (pool) return pool;
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  await ensureDatabaseExists();
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