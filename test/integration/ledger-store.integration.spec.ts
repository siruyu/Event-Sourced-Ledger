import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { LedgerStore } from '@/infrastructure/event-store/ledger.store';
import { AccountRepository } from '@/infrastructure/repositories/account.repository';
import { PostgresTransactionRunner } from '@/infrastructure/db/tx-runner';
import {
  getTestPool,
  resetDatabase,
} from './db';

describe('LedgerStore (append-only event log) [T-03]', () => {
  let pool: Pool;
  let runner: PostgresTransactionRunner;
  let accountsRepo: AccountRepository;
  let store: LedgerStore;

  beforeAll(async () => {
    pool = await getTestPool();
    runner = new PostgresTransactionRunner(pool);
    accountsRepo = new AccountRepository(drizzle(pool, { schema }));
    store = new LedgerStore(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  async function createAccount(
    id: string,
    overrides: Partial<{ normalSide: 'debit' | 'credit'; currency: string }> = {},
  ): Promise<void> {
    await runner.withTransaction((tx) =>
      accountsRepo.insert(tx, {
        id,
        accountNumber: `ACC-${Math.floor(Math.random() * 1_000_000)}`,
        name: `Account ${id.slice(0, 8)}`,
        type: 'checking',
        normalSide: overrides.normalSide ?? 'debit',
        currency: overrides.currency ?? 'USD',
        overdraftLimit: '0',
        status: 'active',
      }),
    );
  }

  async function insertTransaction(
    id: string,
    accountId: string,
    entries: { direction: 'debit' | 'credit'; amount: string }[],
  ): Promise<void> {
    await runner.withTransaction(async (tx) => {
      await store.insertTransaction(tx, { id, type: 'transfer', postedAt: new Date() });
      const locked = await accountsRepo.lockForUpdate(tx, [accountId]);
      let seq = locked[0].currentSequence;
      await store.appendEntries(
        tx,
        entries.map((e) => ({ transactionId: id, accountId, seq: ++seq, direction: e.direction, amount: e.amount, currency: 'USD' })),
      );
      await accountsRepo.bumpSequences(tx, [{ id: accountId, seq }]);
    });
  }

  it('replays an account history in sequence order with no gaps', async () => {
    const acc = randomUUID();
    await createAccount(acc);

    await insertTransaction(randomUUID(), acc, [{ direction: 'debit', amount: '100.0000' }]);
    await insertTransaction(randomUUID(), acc, [{ direction: 'credit', amount: '30.0000' }]);
    await insertTransaction(randomUUID(), acc, [{ direction: 'debit', amount: '5.5000' }]);

    const history = await store.replay(acc);
    expect(history.map((h) => h.seq)).toEqual([1, 2, 3]);
    expect(history.map((h) => h.amount)).toEqual(['100.0000', '30.0000', '5.5000']);
  });

  it('derives the current balance from event history (never a stored column)', async () => {
    const acc = randomUUID();
    await createAccount(acc);

    await insertTransaction(randomUUID(), acc, [{ direction: 'debit', amount: '1000.0000' }]);
    await insertTransaction(randomUUID(), acc, [{ direction: 'credit', amount: '250.0000' }]);
    await insertTransaction(randomUUID(), acc, [{ direction: 'credit', amount: '50.0000' }]);

    const balances = await store.balancesFor([acc]);
    expect(balances.get(acc)).toBe('700.0000');
  });

  it('derives balances for credit-normal (liability) accounts with the opposite sign rule', async () => {
    const acc = randomUUID();
    await createAccount(acc, { normalSide: 'credit' });

    await insertTransaction(randomUUID(), acc, [{ direction: 'credit', amount: '500.0000' }]);
    await insertTransaction(randomUUID(), acc, [{ direction: 'debit', amount: '200.0000' }]);

    const balances = await store.balancesFor([acc]);
    expect(balances.get(acc)).toBe('300.0000');
  });

  it('supports point-in-time derived balances via as-of timestamps', async () => {
    const acc = randomUUID();
    await createAccount(acc);

    const t1 = new Date(Date.now() - 60_000);
    const t2 = new Date(Date.now() - 30_000);
    const t3 = new Date();

    const tx1 = randomUUID();
    const tx2 = randomUUID();
    const tx3 = randomUUID();

    await insertTransaction(tx1, acc, [{ direction: 'debit', amount: '500.0000' }]);
    await pool.query('UPDATE entries SET created_at = $1 WHERE transaction_id = $2', [t1, tx1]);
    await insertTransaction(tx2, acc, [{ direction: 'debit', amount: '300.0000' }]);
    await pool.query('UPDATE entries SET created_at = $1 WHERE transaction_id = $2', [t2, tx2]);
    await insertTransaction(tx3, acc, [{ direction: 'credit', amount: '100.0000' }]);
    await pool.query('UPDATE entries SET created_at = $1 WHERE transaction_id = $2', [t3, tx3]);

    expect((await store.balancesFor([acc], new Date(t1.getTime() + 1))).get(acc)).toBe('500.0000');
    expect((await store.balancesFor([acc], new Date(t2.getTime() + 1))).get(acc)).toBe('800.0000');
    expect((await store.balancesFor([acc])).get(acc)).toBe('700.0000');
  });

  it('enforces UNIQUE(account_id, seq) — no two events may share a history position', async () => {
    const acc = randomUUID();
    await createAccount(acc);

    await expect(
      runner.withTransaction(async (tx) => {
        await store.appendEntries(tx, [
          { transactionId: randomUUID(), accountId: acc, seq: 1, direction: 'debit', amount: '10.0000', currency: 'USD' },
          { transactionId: randomUUID(), accountId: acc, seq: 1, direction: 'credit', amount: '10.0000', currency: 'USD' },
        ]);
      }),
    ).rejects.toThrow(/duplicate key value violates unique constraint/);

    const history = await store.replay(acc);
    expect(history).toHaveLength(0);
  });

  it('rolls back the whole transaction on failure — no partial appends', async () => {
    const acc = randomUUID();
    await createAccount(acc);

    await expect(
      runner.withTransaction(async (tx) => {
        const txId = randomUUID();
        await store.insertTransaction(tx, { id: txId, type: 'transfer', postedAt: new Date() });
        const locked = await accountsRepo.lockForUpdate(tx, [acc]);
        await store.appendEntries(tx, [
          { transactionId: txId, accountId: acc, seq: locked[0].currentSequence + 1, direction: 'debit', amount: '50.0000', currency: 'USD' },
        ]);
        throw new Error('simulated failure after partial work');
      }),
    ).rejects.toThrow('simulated failure after partial work');

    expect(await store.replay(acc)).toHaveLength(0);
    const balances = await store.balancesFor([acc]);
    expect(balances.get(acc)).toBe('0');
  });
});