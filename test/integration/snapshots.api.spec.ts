import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { AppModule } from '@/app.module';
import { AllExceptionsFilter } from '@/common/errors/all-exceptions.filter';
import { InternalAccountsService } from '@/application/internal-accounts.service';
import { SnapshotService } from '@/application/snapshot/snapshot.service';
import { LedgerStore } from '@/infrastructure/event-store/ledger.store';
import { getTestPool, resetDatabase } from './db';

describe('Snapshotting [T-21]', () => {
  let app: INestApplication;
  let pool: Pool;
  let internal: InternalAccountsService;
  let snapshot: SnapshotService;
  let store: LedgerStore;

  beforeAll(async () => {
    process.env.SNAPSHOT_INTERVAL_EVENTS = '5';
    pool = await getTestPool();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    internal = app.get(InternalAccountsService);
    snapshot = app.get(SnapshotService);
    store = app.get(LedgerStore);
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
    delete process.env.SNAPSHOT_INTERVAL_EVENTS;
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    internal.clearCache();
    await internal.getInternalCashAccountId();
  });

  const http = () => app.getHttpServer();

  async function createAccount(overrides: Record<string, unknown> = {}): Promise<string> {
    const res = await request(http())
      .post('/api/v1/accounts')
      .send({ name: 'Snap', ...overrides })
      .expect(201);
    return res.body.id;
  }

  /** Inserts n single-leg debit transactions directly (seq 1..n), fast. */
  async function seedHistory(
    accountId: string,
    n: number,
    postAt?: (i: number) => Date,
  ): Promise<void> {
    const txValues: string[] = [];
    const entryValues: string[] = [];
    for (let i = 1; i <= n; i++) {
      const txId = randomUUID();
      const postedAt = postAt ? `'${postAt(i).toISOString()}'` : 'now()';
      txValues.push(`('${txId}', 'deposit', 'posted', '{}', ${postedAt}, now())`);
      entryValues.push(`('${txId}', '${accountId}', ${i}, 'debit', '1.0000', 'USD')`);
    }
    await pool.query(
      `INSERT INTO transactions (id, type, status, metadata, posted_at, created_at)
       VALUES ${txValues.join(', ')}`,
    );
    await pool.query(
      `INSERT INTO entries (transaction_id, account_id, seq, direction, amount, currency)
       VALUES ${entryValues.join(', ')}`,
    );
  }

  async function fullReplayBalance(accountId: string, asOf?: Date): Promise<string> {
    const { rows } = await pool.query<{ balance: string }>(
      `SELECT COALESCE(SUM(CASE
                    WHEN (e.direction = 'debit'  AND a.normal_side = 'debit')
                      OR (e.direction = 'credit' AND a.normal_side = 'credit')
                    THEN e.amount ELSE -e.amount END), 0)::numeric(19,4) AS balance
         FROM entries e
         JOIN accounts a ON a.id = e.account_id
         JOIN transactions t ON t.id = e.transaction_id
        WHERE e.account_id = $1
          AND ($2::timestamptz IS NULL OR t.posted_at <= $2)`,
      [accountId, asOf ?? null],
    );
    return rows[0].balance;
  }

  it('snapshot-backed current balance equals full replay on a long history', async () => {
    const acc = await createAccount();
    await seedHistory(acc, 1500); // balance +1500.0000

    await snapshot.takeSnapshot(acc, 'USD', 1000);

    const balances = await store.balancesFor([acc]);
    expect(balances.get(acc)).toBe('1500.0000');
    expect(balances.get(acc)).toBe(await fullReplayBalance(acc));
  });

  it('point-in-time reads use the newest qualifying snapshot then replay the remainder', async () => {
    const acc = await createAccount();
    const base = Date.now() - 300_000;
    // entry i is posted at base + i*100ms; seq 1 is oldest, seq 1500 newest.
    await seedHistory(acc, 1500, (i) => new Date(base + i * 100));

    await snapshot.takeSnapshot(acc, 'USD', 1000);
    // Backdate the snapshot so it qualifies for an as-of window that is after
    // the covered entries (seq 1000 ends at base+100000) but before the tail.
    await pool.query(
      'UPDATE snapshots SET created_at = $1 WHERE account_id = $2',
      [new Date(base + 150_000), acc],
    );

    // as_of before the snapshot: falls back to a full replay of the window.
    const before = await store.balancesFor([acc], new Date(base + 50_000));
    expect(before.get(acc)).toBe(await fullReplayBalance(acc, new Date(base + 50_000)));

    // as_of after the snapshot: base from snapshot + trailing entries.
    const after = await store.balancesFor([acc], new Date(base + 160_000));
    expect(after.get(acc)).toBe('1500.0000');
    expect(after.get(acc)).toBe(await fullReplayBalance(acc, new Date(base + 160_000)));

    // A mid-window as_of must equal the full replay too.
    const mid = await store.balancesFor([acc], new Date(base + 120_000));
    expect(mid.get(acc)).toBe(await fullReplayBalance(acc, new Date(base + 120_000)));
  });

  it('maybeSnapshot records a snapshot at interval boundaries after money movements', async () => {
    const acc = await createAccount();
    for (let i = 0; i < 5; i++) {
      await request(http())
        .post(`/api/v1/accounts/${acc}/deposits`)
        .send({ amount: '1.00' })
        .expect(201);
    }

    const { rows } = await pool.query<{ seq: number; balance: string }>(
      'SELECT seq, balance FROM snapshots WHERE account_id = $1 ORDER BY seq',
      [acc],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].seq).toBe(5);
    expect(rows[0].balance).toBe('5.0000');
  });

  it('snapshot writes are idempotent under UNIQUE(account_id, seq)', async () => {
    const acc = await createAccount();
    await seedHistory(acc, 3);
    await snapshot.takeSnapshot(acc, 'USD', 3);
    await snapshot.takeSnapshot(acc, 'USD', 3);

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM snapshots WHERE account_id = $1 AND seq = 3',
      [acc],
    );
    expect(rows[0].n).toBe(1);
  });

  it('reads stay exact even with zero snapshots on the account', async () => {
    const acc = await createAccount();
    await seedHistory(acc, 40);

    const balances = await store.balancesFor([acc]);
    expect(balances.get(acc)).toBe('40.0000');
    expect(balances.get(acc)).toBe(await fullReplayBalance(acc));
  });
});
